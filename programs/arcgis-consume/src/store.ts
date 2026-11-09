import { Database } from "bun:sqlite";
import { existsSync, statSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { ensure } from "./check";
import { validateRunOptions } from "./policy";
function validTimestamp(value: unknown): asserts value is number {
  ensure(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    "invalid cooldown timestamp",
  );
}
function freshDatabase(path: string) {
  if (path === ":memory:") return true;
  if (existsSync(path) && statSync(path).size !== 0) return false;
  // Financial preallocates an empty mode0600 file. Retained bodies/sidecars
  // distinguish damage from initialization and must never be reset.
  ensure(
    readdirSync(dirname(path)).every(
      (name) => name === basename(path) || name === ".civicclerk.lock",
    ),
    "missing cooldown database with prior archive evidence",
  );
  return true;
}
export type Observation = {
  run: string;
  label: string;
  url: string;
  sha256: string;
  bytes: number;
  path: string;
  status: string;
  kind: string;
  retrieved: string;
};
export class Store {
  readonly db: Database;
  constructor(path: string) {
    const fresh = freshDatabase(path);
    this.db = new Database(path, { strict: true });
    try {
      // A missing singleton in an existing database is damage, not initialization.
      if (!fresh) this.notBefore();
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS acquisition_options(run TEXT PRIMARY KEY, options TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,label TEXT NOT NULL,original_url TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,source TEXT REFERENCES sources(id),command TEXT NOT NULL,status TEXT NOT NULL,started TEXT NOT NULL,finished TEXT,error TEXT,summary TEXT);
   CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,run TEXT NOT NULL REFERENCES runs(id),label TEXT NOT NULL,url TEXT NOT NULL,started TEXT NOT NULL,finished TEXT,status INTEGER,headers TEXT,bytes INTEGER NOT NULL DEFAULT 0,error TEXT);
   CREATE TABLE IF NOT EXISTS cooldown(id INTEGER PRIMARY KEY CHECK(id=1),not_before REAL NOT NULL);

   CREATE TABLE IF NOT EXISTS observations(run TEXT NOT NULL REFERENCES runs(id),label TEXT NOT NULL,url TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','ready')),kind TEXT NOT NULL,retrieved TEXT NOT NULL,PRIMARY KEY(run,label));
   CREATE TABLE IF NOT EXISTS versions(source TEXT NOT NULL REFERENCES sources(id),label TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,path TEXT NOT NULL,first_retrieved TEXT NOT NULL,publication_date TEXT,PRIMARY KEY(source,label,sha256));`);
      if (fresh) this.db.exec("INSERT INTO cooldown VALUES(1,0)");
      this.notBefore();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  preflight() {
    ensure(
      this.notBefore() < Number.MAX_SAFE_INTEGER,
      "uninterpretable cooldown: manual review required",
    );
  }
  options(run: string): Record<string, any> | undefined {
    this.preflight();
    const row = this.db
      .query<{ options: string }, [string]>(
        "SELECT options FROM acquisition_options WHERE run=?",
      )
      .get(run);
    return row ? validateRunOptions(JSON.parse(row.options)) : undefined;
  }
  saveOptions(run: string, options: unknown) {
    this.preflight();
    validateRunOptions(options);
    this.db
      .query("INSERT INTO acquisition_options VALUES(?,?)")
      .run(run, JSON.stringify(options));
  }
  close() {
    this.db.close();
  }
  source(id: string, label: string, url: string) {
    this.preflight();
    this.db
      .query(
        "INSERT INTO sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,original_url=excluded.original_url",
      )
      .run(id, label, url);
  }
  start(source: string, command: string) {
    this.preflight();
    const id = crypto.randomUUID();
    this.db
      .query(
        "INSERT INTO runs(id,source,command,status,started) VALUES(?,?,?,'running',?)",
      )
      .run(id, source, command, new Date().toISOString());
    return id;
  }
  resume(id: string, source: string, command: string) {
    this.preflight();
    const row = this.db
      .query<{ source: string; command: string; status: string }, [string]>(
        "SELECT source,command,status FROM runs WHERE id=?",
      )
      .get(id);
    ensure(
      row?.source === source &&
        row.command === command &&
        row.status !== "succeeded",
      "invalid resume run",
    );
    this.db
      .query(
        "UPDATE runs SET status='running',finished=NULL,error=NULL WHERE id=?",
      )
      .run(id);
    return id;
  }
  latestCollection(source: string) {
    this.preflight();
    return this.db
      .query<{ id: string; summary: string }, [string]>(
        "SELECT id,summary FROM runs WHERE source=? AND command IN ('collect','sync') AND status='succeeded' ORDER BY rowid DESC LIMIT 1",
      )
      .get(source);
  }
  finish(id: string, status: string, error?: string, summary?: unknown) {
    this.preflight();
    this.db
      .query("UPDATE runs SET status=?,finished=?,error=?,summary=? WHERE id=?")
      .run(
        status,
        new Date().toISOString(),
        error ?? null,
        summary === undefined ? null : JSON.stringify(summary),
        id,
      );
  }
  attempt(run: string, label: string, url: string, allowance: number) {
    this.preflight();
    ensure(
      Number.isSafeInteger(allowance) && allowance > 0,
      "invalid byte reservation",
    );
    const id = crypto.randomUUID();
    // While unfinished, bytes is a conservative charge, not a received count.
    // Commit it before any wire activity; only a clean finally reconciles it.
    this.db
      .query(
        "INSERT INTO attempts(id,run,label,url,started,bytes) VALUES(?,?,?,?,?,?)",
      )
      .run(id, run, label, url, new Date().toISOString(), allowance);
    return id;
  }
  headers(
    id: string,
    status: number,
    headers: Record<string, string>,
    until: number,
  ) {
    this.notBefore();
    validTimestamp(until);
    this.db
      .transaction(() => {
        this.db
          .query("UPDATE attempts SET status=?,headers=? WHERE id=?")
          .run(status, JSON.stringify(headers), id);
        this.defer(until);
      })
      .immediate();
  }
  finishAttempt(
    id: string,
    status: number | null,
    headers: Record<string, string>,
    bytes: number,
    until: number,
    error?: string,
  ) {
    this.notBefore();
    validTimestamp(until);
    this.db
      .transaction(() => {
        this.db
          .query(
            "UPDATE attempts SET finished=?,status=?,headers=?,bytes=?,error=? WHERE id=?",
          )
          .run(
            new Date().toISOString(),
            status,
            JSON.stringify(headers),
            bytes,
            error ?? null,
            id,
          );
        this.defer(until);
      })
      .immediate();
  }
  defer(until: number) {
    validTimestamp(until);
    const existing = this.notBefore();
    if (until > existing)
      this.db.query("UPDATE cooldown SET not_before=? WHERE id=1").run(until);
  }
  notBefore() {
    let rows: { id: number; not_before: unknown }[];
    try {
      rows = this.db
        .query<{ id: number; not_before: unknown }, []>(
          "SELECT id,not_before FROM cooldown",
        )
        .all();
    } catch {
      throw new Error("missing required cooldown policy");
    }
    ensure(rows.length === 1 && rows[0].id === 1, "invalid cooldown singleton");
    validTimestamp(rows[0].not_before);
    return rows[0].not_before;
  }
  budget(run: string) {
    ensure(
      !this.db
        .query(
          "SELECT 1 FROM attempts WHERE run=? AND finished IS NULL AND bytes=0 LIMIT 1",
        )
        .get(run),
      "unknown interrupted bytes: manual review required",
    );
    return this.db
      .query<{ requests: number; bytes: number }, [string]>(
        "SELECT COUNT(*) requests,COALESCE(SUM(bytes),0) bytes FROM attempts WHERE run=?",
      )
      .get(run)!;
  }
  checkpoint(row: Observation) {
    this.preflight();
    this.db
      .query("INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        row.run,
        row.label,
        row.url,
        row.sha256,
        row.bytes,
        row.path,
        row.status,
        row.kind,
        row.retrieved,
      );
  }
  ready(row: Observation) {
    this.preflight();
    this.db
      .transaction(() => {
        this.db
          .query(
            "UPDATE observations SET status='ready' WHERE run=? AND label=?",
          )
          .run(row.run, row.label);
        this.db
          .query(
            "INSERT OR IGNORE INTO versions SELECT source,?,?,?,?,?,NULL FROM runs WHERE id=?",
          )
          .run(
            row.label,
            row.sha256,
            row.bytes,
            row.path,
            row.retrieved,
            row.run,
          );
      })
      .immediate();
  }
  observation(run: string, label: string) {
    return this.db
      .query<Observation, [string, string]>(
        "SELECT * FROM observations WHERE run=? AND label=?",
      )
      .get(run, label);
  }
  observations() {
    return this.db
      .query<Observation, []>("SELECT * FROM observations ORDER BY rowid")
      .all();
  }
  completed() {
    return this.db
      .query<
        { id: string; source: string; command: string; summary: string },
        []
      >(
        "SELECT id,source,command,summary FROM runs WHERE status='succeeded' AND command IN ('collect','sync') ORDER BY rowid",
      )
      .all();
  }
  verifyHistory() {
    this.preflight();
    const missing = this.db
      .query(
        `SELECT 1 FROM observations o JOIN runs r ON r.id=o.run
      WHERE o.status='ready' AND NOT EXISTS (
        SELECT 1 FROM versions v WHERE v.source=r.source AND v.label=o.label
        AND v.sha256=o.sha256 AND v.bytes=o.bytes) LIMIT 1`,
      )
      .get();
    ensure(
      !missing,
      "version history missing or mismatched for ready observation",
    );
    const orphan = this.db
      .query(
        `SELECT 1 FROM versions v WHERE NOT EXISTS (
      SELECT 1 FROM observations o JOIN runs r ON r.id=o.run
      WHERE o.status='ready' AND r.source=v.source AND o.label=v.label
      AND o.sha256=v.sha256 AND o.bytes=v.bytes AND o.path=v.path
      AND o.retrieved=v.first_retrieved) LIMIT 1`,
      )
      .get();
    ensure(!orphan, "version history representative missing or mismatched");
  }
  integrity() {
    return {
      integrity: this.db
        .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
        .get()!.integrity_check,
      foreignKeys: this.db.query("PRAGMA foreign_key_check").all(),
    };
  }
  status() {
    const count = (table: string, where = "") =>
      this.db
        .query<{ n: number }, []>(`SELECT COUNT(*) n FROM ${table} ${where}`)
        .get()!.n;
    return {
      sources: count("sources"),
      runs: count("runs"),
      running: count("runs", "WHERE status='running'"),
      failed: count("runs", "WHERE status='failed'"),
      attempts: count("attempts"),
      observations: count("observations"),
      versions: count("versions"),
      notBefore: this.notBefore(),
    };
  }
}
