import { Database } from "bun:sqlite";
import type { AppConfig } from "../config";
import type { DocumentManifestEntry, IngestMode, NormalizedItem, NormalizedMeeting } from "../types";

export type StoredDocument = DocumentManifestEntry & {
  id: number;
  downloadStatus: "pending" | "downloaded" | "failed" | "skipped";
  storagePath: string | null;
  sha256: string | null;
  byteSize: number | null;
};

// Translate SQLite column names only at the storage boundary.
type StoredDocumentRow = {
  id: number;
  kind: StoredDocument["kind"];
  title: string;
  source_url: string;
  source_type: StoredDocument["sourceType"];
  required: number;
  event_id: number;
  event_item_id: number | null;
  matter_id: number | null;
  matter_file: string | null;
  attachment_id: number | null;
  attachment_guid: string | null;
  agenda_number: string | null;
  download_status: StoredDocument["downloadStatus"];
  storage_path: string | null;
  sha256: string | null;
  byte_size: number | null;
};

export class AppDatabase {
  readonly db: Database;

  constructor(config: AppConfig) {
    this.db = new Database(config.databasePath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
  }

  migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ingest_runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS meetings (
        event_id INTEGER PRIMARY KEY,
        event_guid TEXT,
        body_id INTEGER,
        body_name TEXT NOT NULL,
        meeting_date TEXT NOT NULL,
        meeting_time TEXT,
        location TEXT,
        agenda_status TEXT,
        minutes_status TEXT,
        portal_url TEXT,
        agenda_url TEXT,
        agenda_packet_url TEXT,
        minutes_url TEXT,
        last_seen_at TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS meeting_items (
        event_item_id INTEGER PRIMARY KEY,
        event_item_guid TEXT,
        event_id INTEGER NOT NULL REFERENCES meetings(event_id),
        agenda_sequence INTEGER,
        minutes_sequence INTEGER,
        agenda_number TEXT,
        title TEXT,
        matter_id INTEGER,
        matter_guid TEXT,
        matter_file TEXT,
        matter_name TEXT,
        matter_type TEXT,
        matter_status TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES meetings(event_id),
        event_item_id INTEGER,
        matter_id INTEGER,
        matter_file TEXT,
        attachment_id INTEGER,
        attachment_guid TEXT,
        agenda_number TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        source_url TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL,
        required INTEGER NOT NULL,
        download_status TEXT NOT NULL DEFAULT 'pending',
        http_status INTEGER,
        content_type TEXT,
        byte_size INTEGER,
        sha256 TEXT,
        storage_path TEXT,
        error TEXT,
        discovered_at TEXT NOT NULL,
        downloaded_at TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS job_checkpoints (
        run_id TEXT NOT NULL,
        checkpoint_key TEXT NOT NULL,
        checkpoint_value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, checkpoint_key)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS http_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        method TEXT,
        url TEXT NOT NULL,
        status INTEGER,
        duration_ms INTEGER,
        retry_count INTEGER,
        created_at TEXT NOT NULL
      )
    `);
  }

  createRun(id: string, mode: IngestMode) {
    this.db
      .query("INSERT INTO ingest_runs (id, mode, status, started_at) VALUES (?, ?, 'running', ?)")
      .run(id, mode, new Date().toISOString());
  }

  finishRun(id: string, status: "succeeded" | "failed", error?: string) {
    this.db
      .query("UPDATE ingest_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?")
      .run(status, new Date().toISOString(), error ?? null, id);
  }

  upsertMeeting(meeting: NormalizedMeeting) {
    this.db
      .query(
        `
        INSERT INTO meetings (
          event_id, event_guid, body_id, body_name, meeting_date, meeting_time, location,
          agenda_status, minutes_status, portal_url, agenda_url, agenda_packet_url, minutes_url, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          event_guid = excluded.event_guid,
          body_id = excluded.body_id,
          body_name = excluded.body_name,
          meeting_date = excluded.meeting_date,
          meeting_time = excluded.meeting_time,
          location = excluded.location,
          agenda_status = excluded.agenda_status,
          minutes_status = excluded.minutes_status,
          portal_url = excluded.portal_url,
          agenda_url = excluded.agenda_url,
          agenda_packet_url = excluded.agenda_packet_url,
          minutes_url = excluded.minutes_url,
          last_seen_at = excluded.last_seen_at
      `,
      )
      .run(
        meeting.eventId,
        meeting.eventGuid,
        meeting.bodyId,
        meeting.bodyName,
        meeting.meetingDate,
        meeting.meetingTime,
        meeting.location,
        meeting.agendaStatus,
        meeting.minutesStatus,
        meeting.portalUrl,
        meeting.agendaUrl,
        meeting.agendaPacketUrl,
        meeting.minutesUrl,
        new Date().toISOString(),
      );
  }

  upsertItem(item: NormalizedItem) {
    this.db
      .query(
        `
        INSERT INTO meeting_items (
          event_item_id, event_item_guid, event_id, agenda_sequence, minutes_sequence, agenda_number,
          title, matter_id, matter_guid, matter_file, matter_name, matter_type, matter_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_item_id) DO UPDATE SET
          event_item_guid = excluded.event_item_guid,
          event_id = excluded.event_id,
          agenda_sequence = excluded.agenda_sequence,
          minutes_sequence = excluded.minutes_sequence,
          agenda_number = excluded.agenda_number,
          title = excluded.title,
          matter_id = excluded.matter_id,
          matter_guid = excluded.matter_guid,
          matter_file = excluded.matter_file,
          matter_name = excluded.matter_name,
          matter_type = excluded.matter_type,
          matter_status = excluded.matter_status
      `,
      )
      .run(
        item.eventItemId,
        item.eventItemGuid,
        item.eventId,
        item.agendaSequence,
        item.minutesSequence,
        item.agendaNumber,
        item.title,
        item.matterId,
        item.matterGuid,
        item.matterFile,
        item.matterName,
        item.matterType,
        item.matterStatus,
      );
  }

  upsertDocument(entry: DocumentManifestEntry): number {
    this.db
      .query(
        `
        INSERT INTO documents (
          event_id, event_item_id, matter_id, matter_file, attachment_id, attachment_guid, agenda_number,
          kind, title, source_url, source_type, required, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_url) DO UPDATE SET
          title = excluded.title,
          source_type = excluded.source_type,
          required = excluded.required,
          discovered_at = excluded.discovered_at
      `,
      )
      .run(
        entry.eventId,
        entry.eventItemId,
        entry.matterId,
        entry.matterFile,
        entry.attachmentId,
        entry.attachmentGuid,
        entry.agendaNumber,
        entry.kind,
        entry.title,
        entry.sourceUrl,
        entry.sourceType,
        entry.required ? 1 : 0,
        new Date().toISOString(),
      );

    const row = this.db.query("SELECT id FROM documents WHERE source_url = ?").get(entry.sourceUrl) as { id: number };
    return row.id;
  }

  getDocumentBySourceUrl(sourceUrl: string): StoredDocument | null {
    const row = this.db.query<StoredDocumentRow, [string]>("SELECT * FROM documents WHERE source_url = ?").get(sourceUrl);
    return row ? rowToStoredDocument(row) : null;
  }

  markDownloaded(id: number, data: { httpStatus: number; contentType: string | null; byteSize: number; sha256: string; storagePath: string }) {
    this.db
      .query(
        `
        UPDATE documents
        SET download_status = 'downloaded', http_status = ?, content_type = ?, byte_size = ?,
            sha256 = ?, storage_path = ?, error = NULL, downloaded_at = ?
        WHERE id = ?
      `,
      )
      .run(data.httpStatus, data.contentType, data.byteSize, data.sha256, data.storagePath, new Date().toISOString(), id);
  }

  markFailed(id: number, error: string, httpStatus?: number) {
    this.db
      .query("UPDATE documents SET download_status = 'failed', error = ?, http_status = ? WHERE id = ?")
      .run(error, httpStatus ?? null, id);
  }

  setCheckpoint(runId: string, key: string, value: unknown) {
    this.db
      .query(
        `
        INSERT INTO job_checkpoints (run_id, checkpoint_key, checkpoint_value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(run_id, checkpoint_key) DO UPDATE SET
          checkpoint_value_json = excluded.checkpoint_value_json,
          updated_at = excluded.updated_at
      `,
      )
      .run(runId, key, JSON.stringify(value), new Date().toISOString());
  }
}

function rowToStoredDocument(row: StoredDocumentRow): StoredDocument {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    required: Boolean(row.required),
    eventId: row.event_id,
    eventItemId: row.event_item_id,
    matterId: row.matter_id,
    matterFile: row.matter_file,
    attachmentId: row.attachment_id,
    attachmentGuid: row.attachment_guid,
    agendaNumber: row.agenda_number,
    downloadStatus: row.download_status,
    storagePath: row.storage_path,
    sha256: row.sha256,
    byteSize: row.byte_size,
  };
}

