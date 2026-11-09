import { Database } from "bun:sqlite";
import { existsSync, statSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { ensure } from "./check";
import { validateRunOptions } from "./policy";
import {
  timingSchema,
  validateTiming,
  serverObligation,
  timestamp,
  checkpointTiming,
  type TimingEvent,
} from "./timing";

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
  private active = new Set<string>();
  private clock: { now: () => number; domain: string; spacingMs: number };
  constructor(
    path: string,
    clock: Partial<{
      now: () => number;
      domain: string;
      spacingMs: number;
    }> = {},
  ) {
    this.clock = {
      now: Date.now,
      domain: "unix-epoch-ms",
      spacingMs: 0,
      ...clock,
    };
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
      if (fresh) this.db.exec(timingSchema);
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
  private facts() {
    return validateTiming(this.db, this.gate(), this.active);
  }
  private event(
    phase: string,
    attempt: string | null,
    until: number,
    detail: Record<string, unknown>,
  ): TimingEvent {
    const facts = this.facts(),
      at = this.clock.now(),
      wall = Date.now();
    timestamp(at);
    timestamp(wall);
    timestamp(until);
    ensure(
      facts.domain === undefined || facts.domain === this.clock.domain,
      "timing clock domain changed: operator review required",
    );
    ensure(
      at >= facts.lastClock,
      "timing clock rollback: operator review required",
    );
    return {
      id: crypto.randomUUID(),
      phase,
      attempt,
      domain: this.clock.domain,
      clock_ms: at,
      wall_ms: wall,
      until_ms: until,
      detail: JSON.stringify(detail),
    };
  }
  private record(event: TimingEvent, apply: () => void = () => {}) {
    const gate = this.notBefore();
    this.db
      .transaction(() => {
        apply();
        this.db
          .query("INSERT INTO timing_events VALUES(?,?,?,?,?,?,?,?)")
          .run(
            event.id,
            event.phase,
            event.attempt,
            event.domain,
            event.clock_ms,
            event.wall_ms,
            event.until_ms,
            event.detail,
          );
        if (event.until_ms > gate)
          this.db
            .query("UPDATE cooldown SET not_before=? WHERE id=1")
            .run(event.until_ms);
      })
      .immediate();
  }
  minimumSpacing() {
    return Math.max(this.clock.spacingMs, this.facts().spacingMs);
  }
  recordSpacing(ms: number) {
    this.preflight();
    timestamp(ms);
    const event = this.event("spacing", null, 0, { spacingMs: ms });
    event.until_ms = event.clock_ms + ms;
    timestamp(event.until_ms);
    this.record(event);
  }
  dispatch(id: string, spacingMs: number) {
    this.preflight();
    timestamp(spacingMs);
    const event = this.event("dispatch", id, 0, { spacingMs });
    ensure(
      event.clock_ms >= this.notBefore(),
      "transport before retained cooldown obligation",
    );
    this.active.add(id);
    try {
      this.record(event);
    } catch (error) {
      this.active.delete(id);
      throw error;
    }
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
    this.event("defer", null, 0, {}); // Validate active clock before a new run.
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
    const event = this.event("reserve", id, 0, { run, label, url });
    this.record(event, () =>
      this.db
        .query(
          "INSERT INTO attempts(id,run,label,url,started,bytes) VALUES(?,?,?,?,?,?)",
        )
        .run(
          id,
          run,
          label,
          url,
          new Date(event.wall_ms).toISOString(),
          allowance,
        ),
    );
    return id;
  }
  headers(
    id: string,
    status: number,
    headers: Record<string, string>,
    until: number,
  ) {
    this.notBefore();
    timestamp(until, "invalid cooldown timestamp");
    const event = this.event("headers", id, 0, {
      status,
      headers,
      requestedUntil: until,
    });
    event.until_ms = Math.max(until, serverObligation(headers, event.clock_ms));
    this.record(event, () =>
      this.db
        .query("UPDATE attempts SET status=?,headers=? WHERE id=?")
        .run(status, JSON.stringify(headers), id),
    );
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
    timestamp(until, "invalid cooldown timestamp");
    const spacingMs = this.minimumSpacing();
    const event = this.event("complete", id, 0, {
      status,
      headers,
      bytes,
      error,
      requestedUntil: until,
      spacingMs,
    });
    event.until_ms = Math.max(
      until,
      event.clock_ms + spacingMs,
      this.facts().attempts.get(id)?.headers?.until_ms ??
        serverObligation(headers, event.clock_ms),
    );
    timestamp(event.until_ms);
    this.record(event, () =>
      this.db
        .query(
          "UPDATE attempts SET finished=?,status=?,headers=?,bytes=?,error=? WHERE id=?",
        )
        .run(
          new Date(event.wall_ms).toISOString(),
          status,
          JSON.stringify(headers),
          bytes,
          error ?? null,
          id,
        ),
    );
    this.active.delete(id);
  }
  defer(until: number) {
    timestamp(until, "invalid cooldown timestamp");
    const existing = this.notBefore();
    if (until > existing) this.record(this.event("defer", null, until, {}));
  }
  notBefore() {
    const gate = this.gate();
    validateTiming(this.db, gate, this.active);
    return gate;
  }
  private gate() {
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
    timestamp(rows[0].not_before, "invalid cooldown timestamp");
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
    const attempt =
      this.db
        .query<{ id: string }, [string]>("SELECT id FROM attempts WHERE id=?")
        .get(row.path.replace(/\.body$/, ""))?.id ?? null;
    const event = this.event("checkpoint", attempt, 0, {
      run: row.run,
      label: row.label,
      path: row.path,
      retrieved: row.retrieved,
    });
    checkpointTiming(event, row, this.facts().attempts.get(attempt ?? ""));
    this.record(event, () =>
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
        ),
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
