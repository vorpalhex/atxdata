import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { CivicEvent, PublishedFile } from "../types";

export type DocumentEntry = PublishedFile & { filename: string; sourceUrl: string };
export type StoredDocument = { filename: string; sourceUrl: string; byteSize: number | null; sha256: string | null; downloadStatus: "pending" | "downloaded" | "failed" };
type DocumentRow = { filename: string; source_url: string; byte_size: number | null; sha256: string | null; download_status: StoredDocument["downloadStatus"] };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS document_versions (
    tenant TEXT NOT NULL, event_id INTEGER NOT NULL, file_type INTEGER NOT NULL, file_id INTEGER NOT NULL,
    sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, source_url TEXT NOT NULL, filename TEXT NOT NULL, downloaded_at TEXT NOT NULL,
    PRIMARY KEY(tenant,event_id,file_type,file_id,sha256)
  );
  CREATE TABLE IF NOT EXISTS event_snapshots (
    tenant TEXT NOT NULL, event_id INTEGER NOT NULL, sha256 TEXT NOT NULL,
    observed_at TEXT NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(tenant,event_id,sha256)
  );
  CREATE TABLE IF NOT EXISTS meetings (
    tenant TEXT NOT NULL, event_id INTEGER NOT NULL, event_name TEXT NOT NULL,
    meeting_date TEXT NOT NULL, last_seen_at TEXT NOT NULL,
    PRIMARY KEY (tenant, event_id)
  );
  CREATE TABLE IF NOT EXISTS documents (
    tenant TEXT NOT NULL, event_id INTEGER NOT NULL, file_id INTEGER NOT NULL,
    file_type INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    filename TEXT NOT NULL, source_url TEXT NOT NULL,
    download_status TEXT NOT NULL DEFAULT 'pending' CHECK(download_status IN ('pending','downloaded','failed')),
    byte_size INTEGER, sha256 TEXT, error TEXT, downloaded_at TEXT,
    PRIMARY KEY (tenant, event_id, file_type, file_id),
    FOREIGN KEY (tenant, event_id) REFERENCES meetings(tenant, event_id)
  );
  CREATE TABLE IF NOT EXISTS ingest_runs (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, event_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
    started_at TEXT NOT NULL, finished_at TEXT, error TEXT,
    FOREIGN KEY (tenant, event_id) REFERENCES meetings(tenant, event_id)
  );
`;

export class CivicDatabase {
  readonly db: Database;
  constructor(path: string, private readonly tenant: string) {
    this.db = new Database(path, { strict: true });
    try {
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA foreign_keys = ON");
      this.db.exec(SCHEMA);
      this.db.run(`INSERT OR IGNORE INTO document_versions SELECT tenant,event_id,file_type,file_id,sha256,byte_size,source_url,filename,downloaded_at
        FROM documents WHERE sha256 IS NOT NULL AND byte_size IS NOT NULL AND downloaded_at IS NOT NULL`);
      this.db.transaction(() => {
        this.db.run("CREATE TABLE IF NOT EXISTS archive_settings (id INTEGER PRIMARY KEY CHECK(id=1), tenant TEXT NOT NULL)");
        const other = this.db.query("SELECT tenant FROM meetings WHERE tenant<>? LIMIT 1").get(this.tenant);
        if (other) throw new Error("output directory belongs to another tenant");
        this.db.query("INSERT OR IGNORE INTO archive_settings (id,tenant) VALUES (1,?)").run(this.tenant);
        const binding = this.db.query<{ tenant: string }, []>("SELECT tenant FROM archive_settings WHERE id=1").get();
        if (binding?.tenant !== this.tenant) throw new Error("output directory belongs to another tenant");
      }).immediate();
    } catch (error) { this.db.close(); throw error; }
  }
  close(): void { this.db.close(); }
  snapshot(event: CivicEvent): void {
    const metadata = JSON.stringify(event), hash = createHash("sha256").update(metadata).digest("hex");
    this.db.query("INSERT INTO event_snapshots VALUES (?,?,?,?,?) ON CONFLICT(tenant,event_id,sha256) DO UPDATE SET observed_at=excluded.observed_at").run(this.tenant, event.id, hash, new Date().toISOString(), metadata);
  }
  cachedEvent(id: number): CivicEvent {
    const row = this.db.query<{ metadata: string }, [string, number]>("SELECT metadata FROM event_snapshots WHERE tenant=? AND event_id=? ORDER BY observed_at DESC, rowid DESC LIMIT 1").get(this.tenant, id);
    if (!row) throw new Error("offline event missing");
    return JSON.parse(row.metadata);
  }
  upsertMeeting(event: CivicEvent): void {
    this.db.query(`INSERT INTO meetings VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant,event_id) DO UPDATE SET event_name=excluded.event_name,
      meeting_date=excluded.meeting_date, last_seen_at=excluded.last_seen_at`)
      .run(this.tenant, event.id, event.eventName, event.eventDate, new Date().toISOString());
  }
  discover(eventId: number, file: DocumentEntry): void {
    this.db.query(`INSERT INTO documents (tenant,event_id,file_id,file_type,kind,title,filename,source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant,event_id,file_type,file_id) DO UPDATE SET
      kind=excluded.kind,title=excluded.title,filename=excluded.filename,source_url=excluded.source_url,
      download_status=CASE WHEN documents.filename=excluded.filename AND documents.source_url=excluded.source_url
        THEN documents.download_status ELSE 'pending' END,
      byte_size=CASE WHEN documents.filename=excluded.filename AND documents.source_url=excluded.source_url THEN documents.byte_size END,
      sha256=CASE WHEN documents.filename=excluded.filename AND documents.source_url=excluded.source_url THEN documents.sha256 END`)
      .run(this.tenant, eventId, file.fileId, file.fileType, file.type, file.name, file.filename, file.sourceUrl);
  }
  document(eventId: number, file: PublishedFile): StoredDocument | undefined {
    const row = this.db.query<DocumentRow, [string, number, number, number]>(`SELECT filename,source_url,byte_size,sha256,download_status FROM documents
      WHERE tenant=? AND event_id=? AND file_type=? AND file_id=?`).get(this.tenant, eventId, file.fileType, file.fileId);
    return row ? { filename: row.filename, sourceUrl: row.source_url, byteSize: row.byte_size, sha256: row.sha256, downloadStatus: row.download_status } : undefined;
  }
  downloaded(eventId: number, file: PublishedFile, data: { byteSize: number; sha256: string }): void {
    this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.query(`INSERT OR IGNORE INTO document_versions SELECT tenant,event_id,file_type,file_id,?,?,source_url,filename,?
        FROM documents WHERE tenant=? AND event_id=? AND file_type=? AND file_id=?`)
        .run(data.sha256, data.byteSize, now, this.tenant, eventId, file.fileType, file.fileId);
      this.db.query(`UPDATE documents SET download_status='downloaded',byte_size=?,sha256=?,error=NULL,downloaded_at=?
        WHERE tenant=? AND event_id=? AND file_type=? AND file_id=?`)
        .run(data.byteSize, data.sha256, now, this.tenant, eventId, file.fileType, file.fileId);
    }).immediate();
  }
  failed(eventId: number, file: PublishedFile, error: string): void {
    this.db.query(`UPDATE documents SET download_status='failed',error=? WHERE tenant=? AND event_id=? AND file_type=? AND file_id=?`)
      .run(error, this.tenant, eventId, file.fileType, file.fileId);
  }
  startRun(eventId: number): string {
    const id = crypto.randomUUID();
    this.db.query("INSERT INTO ingest_runs (id,tenant,event_id,status,started_at) VALUES (?, ?, ?, 'running', ?)")
      .run(id, this.tenant, eventId, new Date().toISOString());
    return id;
  }
  finishRun(id: string, status: "succeeded" | "failed", error?: string): void {
    this.db.query("UPDATE ingest_runs SET status=?,finished_at=?,error=? WHERE id=? AND tenant=?")
      .run(status, new Date().toISOString(), error ?? null, id, this.tenant);
  }
}
