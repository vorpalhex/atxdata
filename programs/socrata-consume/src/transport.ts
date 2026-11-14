import { Database } from "bun:sqlite";
import {
  existsSync,
  readdirSync,
  lstatSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { Archive, type Dependencies } from "../../arcgis-consume/src/archive";
import { archiveLock } from "../../civicclerk-consume/src/archive";
import { validateSourceSchema } from "../../financial-transparency-consume/src/source-schema";
import { validateTiming } from "../../arcgis-consume/src/timing";
import {
  origin,
  catalogOrigin,
  ensure,
  positive,
  operationFormat,
  validateIdentity,
} from "./source";
export type Budget = {
  requests: number;
  responseBytes: number;
  totalBytes: number;
  zipBytes: number;
  retries: number;
  records: number;
};
export function budget(value: Partial<Budget> = {}): Budget {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "invalid budget",
  );
  const allowed = [
    "requests",
    "responseBytes",
    "totalBytes",
    "zipBytes",
    "retries",
    "records",
  ];
  ensure(
    Object.keys(value).every((key) => allowed.includes(key)),
    "unknown budget key",
  );
  const result = {
    requests: 10000,
    responseBytes: 20_000_000,
    totalBytes: 2_000_000_000,
    zipBytes: 20_000_000,
    retries: 0,
    records: 10_000_000,
    ...value,
  };
  for (const [key, val] of Object.entries(result))
    positive(val, key, key === "retries" ? 0 : 1);
  ensure(
    result.retries === 0,
    "automatic retries disabled; resume after definite HTTP failure",
  );
  return result;
}
export const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function safePath(root: string) {
  const checkout = resolve(import.meta.dir, "../../..");
  ensure(
    isAbsolute(root) && root === resolve(root) && root !== dirname(root),
    "archive must be canonical absolute non-root path",
  );
  ensure(
    root !== checkout && !root.startsWith(checkout + "/"),
    "archive must be outside source checkout",
  );
  for (let path = root; path !== dirname(path); path = dirname(path))
    if (
      existsSync(path) ||
      (() => {
        try {
          return lstatSync(path).isSymbolicLink();
        } catch {
          return false;
        }
      })()
    )
      ensure(
        !lstatSync(path).isSymbolicLink(),
        "unsafe symlink in archive path",
      );
}
function file(path: string) {
  const stat = lstatSync(path);
  ensure(stat.isFile() && !stat.isSymbolicLink(), "unsafe archive file");
  ensure((stat.mode & 0o077) === 0, "archive file must be private");
  return stat;
}
function verifyObservation(
  db: Database,
  root: string,
  row: Record<string, any>,
) {
  ensure(/^[a-f0-9-]{36}\.body$/.test(row.path), "unsafe original path");
  const attempt = db
    .query<Record<string, any>, [string]>("SELECT * FROM attempts WHERE id=?")
    .get(row.path.slice(0, -5));
  ensure(attempt, "missing original attempt");
  for (const key of ["run", "label", "url", "bytes"])
    ensure(attempt[key] === row[key], "original attempt provenance mismatch");
  ensure(
    attempt.status === 200 && attempt.finished && attempt.error === null,
    "original attempt provenance mismatch",
  );
  const path = join(root, row.path),
    retained = existsSync(path) ? path : path + ".pending";
  ensure(
    row.status === "pending" || retained === path,
    "ready original missing",
  );
  ensure(
    file(retained).size === row.bytes &&
      hash(readFileSync(retained)) === row.sha256,
    "original checksum mismatch",
  );
}
function verifyBodies(db: Database, root: string) {
  const known = new Set<string>();
  const observations = db
    .query<Record<string, any>, []>("SELECT * FROM observations")
    .all();
  for (const row of observations) verifyObservation(db, root, row);
  for (const row of db
    .query<{ id: string }, []>("SELECT id FROM attempts")
    .all())
    for (const suffix of [".body", ".body.pending", ".body.part"])
      known.add(row.id + suffix);
  for (const name of readdirSync(root)) {
    ensure(
      /^state\.sqlite(?:-wal|-shm)?$/.test(name) || known.has(name),
      "unknown archive artifact",
    );
    file(join(root, name));
  }
}
function verifyVersions(db: Database) {
  const observations = db
    .query<Record<string, any>, []>(
      "SELECT o.*,r.source FROM observations o JOIN runs r ON r.id=o.run ORDER BY o.rowid",
    )
    .all();
  const expected = new Map<string, Record<string, any>>();
  for (const row of observations) {
    const key = JSON.stringify([row.source, row.label, row.sha256]);
    if (!expected.has(key)) expected.set(key, row);
  }
  const versions = db
    .query<Record<string, any>, []>("SELECT * FROM versions")
    .all();
  ensure(versions.length === expected.size, "version inventory mismatch");
  for (const version of versions) {
    const row = expected.get(
      JSON.stringify([version.source, version.label, version.sha256]),
    );
    ensure(row, "orphan version");
    ensure(
      version.bytes === row.bytes &&
        version.path === row.path &&
        version.first_retrieved === row.retrieved &&
        version.publication_date === null,
      "version observation mismatch",
    );
  }
}
function verifyOptions(db: Database) {
  for (const row of db
    .query<{ options: string }, []>("SELECT options FROM acquisition_options")
    .all()) {
    const options = JSON.parse(row.options);
    validateIdentity(options?.format);
    ensure(
      options?.representation === "fetch-decoded-body",
      "unsupported operation identity/representation",
    );
    positive(options.timeoutMs, "operation timeoutMs");
    budget(options.budget);
  }
}
export function transportPreflight(root: string) {
  safePath(root);
  if (!existsSync(root)) return;
  ensure(
    lstatSync(root).isDirectory() && (lstatSync(root).mode & 0o077) === 0,
    "archive directory must be private",
  );
  const path = join(root, "state.sqlite");
  if (!existsSync(path)) {
    ensure(
      readdirSync(root).length === 0,
      "orphan originals without policy database",
    );
    return;
  }
  file(path);
  const db = new Database(path, { readonly: true, strict: true });
  try {
    validateSourceSchema(db);
    const gates = db
      .query<{ id: number; not_before: number }, []>("SELECT * FROM cooldown")
      .all();
    ensure(
      gates.length === 1 && gates[0]!.id === 1,
      "missing cooldown singleton",
    );
    validateTiming(db, gates[0]!.not_before);
    ensure(
      gates[0]!.not_before < Number.MAX_SAFE_INTEGER,
      "cooldown requires manual review",
    );
    ensure(
      !db
        .query(
          "SELECT 1 FROM attempts a WHERE finished IS NULL OR status IS NULL OR (status BETWEEN 200 AND 299 AND error IS NOT NULL AND NOT EXISTS(SELECT 1 FROM observations o WHERE o.path=a.id||'.body')) LIMIT 1",
        )
        .get(),
      "unknown transfer requires manual review",
    );
    ensure(
      db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()
        ?.integrity_check === "ok" &&
        !db.query("PRAGMA foreign_key_check").get(),
      "SQLite integrity failed",
    );
    verifyOptions(db);
    verifyVersions(db);
    verifyBodies(db, root);
  } finally {
    db.close();
  }
}
export function admitted(url: string) {
  const u = new URL(url);
  ensure(!u.username && !u.password && !u.hash, "unsafe URL");
  const path = u.pathname;
  ensure(
    (u.origin === origin &&
      (/^\/api\/views\/[a-z0-9]{4}-[a-z0-9]{4}\.json$/.test(path) ||
        /^\/resource\/[a-z0-9]{4}-[a-z0-9]{4}\.json$/.test(path) ||
        path === "/robots.txt")) ||
      (u.origin === catalogOrigin &&
        (path === "/api/catalog/v1" || path === "/robots.txt")),
    "unsupported source URL",
  );
}
let activeOwner = false;
export class Session {
  private busy = false;
  private constructor(
    readonly root: string,
    readonly archive: Archive,
    private release: () => Promise<void>,
    readonly timeoutMs: number,
  ) {}
  static async open(
    root: string,
    deps: Partial<Dependencies> = {},
    timeoutMs = 45000,
  ) {
    safePath(root);
    positive(timeoutMs, "timeoutMs");
    ensure(timeoutMs <= 2147483647, "timeout too large");
    transportPreflight(join(root, "transport"));
    ensure(!activeOwner, "one source archive owner per process required");
    activeOwner = true;
    const mask = process.umask(0o077);
    let release: (() => Promise<void>) | undefined;
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      ensure(
        (lstatSync(root).mode & 0o077) === 0,
        "archive directory must be private",
      );
      release = await archiveLock(root);
      await mkdir(join(root, "transport"), { mode: 0o700, recursive: true });
      const wire =
        deps.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
      const archive = await Archive.open(join(root, "transport"), {
        ...deps,
        fetch: (url, init) =>
          wire(url, {
            ...init,
            signal: AbortSignal.any([
              init.signal!,
              AbortSignal.timeout(timeoutMs),
            ]),
          }),
      });
      archive.guard = admitted;
      for (const name of readdirSync(archive.root))
        if (/^state\.sqlite(?:-wal|-shm)?$/.test(name))
          chmodSync(join(archive.root, name), 0o600);
      const unlock = release;
      return new Session(
        root,
        archive,
        async () => {
          try {
            await unlock();
          } finally {
            process.umask(mask);
            activeOwner = false;
          }
        },
        timeoutMs,
      );
    } catch (error) {
      try {
        await release?.();
      } finally {
        process.umask(mask);
        activeOwner = false;
      }
      throw error;
    }
  }
  start(
    command: string,
    options: Record<string, unknown>,
    limits: Partial<Budget> = {},
  ) {
    const validated = budget(limits);
    const source = "socrata:austin";
    this.archive.store.source(source, "Austin Socrata", origin);
    const run = this.archive.store.start(source, command);
    this.archive.store.saveOptions(run, {
      ...options,
      format: operationFormat,
      representation: "fetch-decoded-body",
      timeoutMs: this.timeoutMs,
      budget: validated,
    });
    return run;
  }
  async request(
    run: string,
    label: string,
    url: string,
    validate: (text: string) => unknown = () => {},
  ) {
    admitted(url);
    ensure(!this.busy, "one source operation required");
    this.busy = true;
    try {
      const result = await this.archive.request(
        run,
        label,
        url,
        "text",
        (value) => {
          ensure(typeof value === "string", "expected raw text");
          const retained = this.archive.store.observation(run, label);
          const attempt = this.archive.store.db
            .query<{ id: string }, [string, string]>(
              "SELECT id FROM attempts WHERE run=? AND label=? ORDER BY rowid DESC LIMIT 1",
            )
            .get(run, label);
          ensure(attempt, "missing text producer");
          const path = join(
            this.archive.root,
            retained?.path ?? attempt.id + ".body.pending",
          );
          let exact: string;
          try {
            exact = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(readFileSync(path));
          } catch {
            throw Error("invalid UTF-8 original");
          }
          ensure(exact === value, "UTF-8 representation mismatch");
          return validate(exact);
        },
      );
      ensure(typeof result === "string", "expected raw text");
      const row = this.archive.store.observation(run, label)!;
      chmodSync(join(this.archive.root, row.path), 0o400);
      return result;
    } finally {
      this.busy = false;
    }
  }
  async close() {
    try {
      await this.archive.close();
    } finally {
      await this.release();
    }
  }
}
