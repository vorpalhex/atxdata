import { Database } from "bun:sqlite";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";
import { ensure, object, same } from "./check";
import { readonlySQLiteImage } from "./app-wal";
import {
  markedApp,
  validateAppCheckpoint,
  type AppRun,
  type AppIntent,
} from "./app-intent";
import { v2Receipt } from "./app-data";
import { itemUrl } from "./sources";
import { validateTiming } from "./timing";
async function info(path: string) {
  try {
    return await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
async function bytes(path: string) {
  const s = await info(path);
  if (!s) return undefined;
  ensure(
    s.isFile() && !s.isSymbolicLink() && s.size <= 64 * 1024 * 1024,
    "unsafe/oversized readonly source file",
  );
  return readFile(path);
}
async function snapshot(root: string) {
  const main = join(root, "state.sqlite"),
    wal = main + "-wal";
  const db = await bytes(main),
    log = await bytes(wal);
  ensure(db, "archive state disappeared during readonly inspection");
  const image = readonlySQLiteImage(db, log);
  ensure(
    db.equals((await bytes(main)) ?? Buffer.alloc(0)),
    "readonly database snapshot changed",
  );
  ensure(
    (log ?? Buffer.alloc(0)).equals((await bytes(wal)) ?? Buffer.alloc(0)),
    "readonly WAL snapshot changed",
  );
  return Database.deserialize(image, { readonly: true, strict: true });
}
function rows(db: Database) {
  return db
    .query<AppRun & { options: string | null }, []>(
      "SELECT r.id,r.source,r.command,r.status,r.summary,o.options FROM runs r LEFT JOIN acquisition_options o ON o.run=r.id ORDER BY r.rowid",
    )
    .all();
}
function missingDataReceipt(db: Database, r: AppRun) {
  if (r.status !== "succeeded") return;
  const summary = object(JSON.parse(r.summary!));
  const row = db
    .query<{ n: number }, [string, string]>(
      "SELECT COUNT(*) n FROM attempts WHERE run=? AND label=?",
    )
    .get(r.id, "app-data");
  ensure(
    row?.n === 0 &&
      summary.representation === "not-requested" &&
      !Object.hasOwn(summary, "appDataReceipt") &&
      /^item-(unavailable|error)$/.test(String(summary.outcome)),
    "v2 successful app-data observation/receipt missing",
  );
}
export async function validateV2Ready(
  db: Database,
  root: string,
  r: AppRun,
  s: AppIntent,
) {
  const o = db
    .query<{ bytes: number; status: string }, [string, string]>(
      "SELECT bytes,status FROM observations WHERE run=? AND label=?",
    )
    .get(r.id, "app-data");
  if (!o) {
    missingDataReceipt(db, r);
    return;
  }
  ensure(o.status === "ready", "v2 pending app-data cannot be adopted");
  const representation = o.bytes === 0 ? "empty-body" : "json";
  const receipt = v2Receipt(
    db,
    r.id,
    itemUrl(s.selection.item, true),
    representation,
  );
  const raw = await bytes(join(root, receipt.attempt + ".body"));
  ensure(
    raw &&
      raw.length === receipt.bytes &&
      createHash("sha256").update(raw).digest("hex") === receipt.sha256,
    "v2 readonly body binding mismatch",
  );
  if (r.status === "succeeded") {
    const summary = object(JSON.parse(r.summary!));
    ensure(
      summary.representation === representation &&
        same(summary.appDataReceipt, receipt),
      "v2 representation/producer summary mismatch",
    );
  }
}
export function readonlyGate(db: Database) {
  const values = db
    .query<{ id: number; not_before: number }, []>(
      "SELECT id,not_before FROM cooldown",
    )
    .all();
  ensure(
    values.length === 1 && values[0]!.id === 1,
    "missing readonly cooldown singleton",
  );
  const n = values[0]!.not_before;
  ensure(Number.isSafeInteger(n) && n >= 0, "invalid readonly cooldown");
  ensure(
    n < Number.MAX_SAFE_INTEGER,
    "uninterpretable cooldown: manual review required",
  );
  validateTiming(db, n, new Set());
  return n;
}
async function checkSnapshot(db: Database, root: string, workflow: boolean) {
  ensure(
    (db.query("PRAGMA integrity_check").get() as { integrity_check: string })
      .integrity_check === "ok",
    "readonly SQLite integrity failed",
  );
  const marked = rows(db)
    .map((r) => ({
      r,
      s: r.options === null ? undefined : object(JSON.parse(r.options)),
    }))
    .filter(({ r, s }) =>
      markedApp(
        r,
        s,
        Boolean(
          db
            .query(
              "SELECT 1 FROM observations WHERE run=? AND label LIKE ? LIMIT 1",
            )
            .get(r.id, "app-%"),
        ),
      ),
    );
  if (!workflow && marked.length === 0) return;
  readonlyGate(db);
  for (const { r, s } of marked) {
    const intent = validateAppCheckpoint(r, s);
    if (intent.receiptVersion === 2) await validateV2Ready(db, root, r, intent);
  }
}
function rootLocation(root: string) {
  const repo = resolve(import.meta.dir, "../../..");
  ensure(
    isAbsolute(root) && resolve(root) === root,
    "readonly archive root must be canonical absolute",
  );
  ensure(
    root !== repo && !root.startsWith(repo + "/"),
    "readonly archive must be outside source",
  );
}
async function rootDirectory(root: string) {
  rootLocation(root);
  const dir = await info(root);
  let current = root;
  for (;;) {
    const value = await info(current);
    if (value)
      ensure(
        value.isDirectory() && !value.isSymbolicLink(),
        "readonly root has unsafe symlink/ancestor",
      );
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dir;
}
/** Reuse the same bounded readonly SQLite/WAL snapshot; never open a writer. */
export async function withReadOnlyArchive(
  root: string,
  inspect: (db: Database) => Promise<void>,
  required = false,
) {
  const dir = await rootDirectory(root);
  ensure(!required || dir, "policy inspection requires an existing archive");
  if (!dir) return;
  ensure(
    !(await info(join(root, ".civicclerk.lock"))),
    "archive locked; readonly refusal",
  );
  const exists = await info(join(root, "state.sqlite"));
  ensure(
    !required || exists,
    "policy inspection requires existing source metadata",
  );
  if (!exists) return;
  const db = await snapshot(root);
  try {
    ensure(
      (db.query("PRAGMA integrity_check").get() as { integrity_check: string })
        .integrity_check === "ok",
      "readonly SQLite integrity failed",
    );
    await inspect(db);
    const latest = await snapshot(root);
    try {
      ensure(
        db.serialize().equals(latest.serialize()),
        "readonly source ledger changed during verification",
      );
    } finally {
      latest.close();
    }
    ensure(
      !(await info(join(root, ".civicclerk.lock"))),
      "archive locked; readonly refusal",
    );
  } finally {
    db.close();
  }
}
export async function readOnlyAppPreflight(root: string, workflow = false) {
  const dir = await rootDirectory(root);
  if (!dir) return;
  ensure(
    !(await info(join(root, ".civicclerk.lock"))),
    "archive locked; readonly refusal",
  );
  if (!(await info(join(root, "state.sqlite")))) {
    if (workflow)
      ensure(
        (await readdir(root)).length === 0,
        "missing archive state with retained files",
      );
    return;
  }
  const db = await snapshot(root);
  try {
    await checkSnapshot(db, root, workflow);
  } finally {
    db.close();
  }
}
