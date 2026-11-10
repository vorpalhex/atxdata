import { Database } from "bun:sqlite";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { validateDefinitions } from "../../financial-transparency-consume/src/source-schema";
import { ensure, selection, decodeRows, resourceURL } from "./source";
import {
  decodeSchema,
  revision,
  decodeCount,
  schemaURL,
  countURL,
  decodeCatalog,
  catalogURL,
} from "./catalog";
import { verifyOperations } from "./ledger";
import { hash, transportPreflight } from "./transport";
export const definitions = [
  "CREATE TABLE pages(snapshot TEXT NOT NULL REFERENCES snapshots(id),offset INTEGER NOT NULL,count INTEGER NOT NULL,label TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(snapshot,offset))",
  "CREATE TABLE snapshots(id TEXT PRIMARY KEY,selection TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('partial','complete')),source_count TEXT NOT NULL,revision TEXT NOT NULL)",
  "CREATE TABLE source_rows(snapshot TEXT NOT NULL REFERENCES snapshots(id),ordinal INTEGER NOT NULL,page_offset INTEGER NOT NULL,source_id TEXT NOT NULL,source_json TEXT NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(snapshot,ordinal),UNIQUE(snapshot,source_id))",
];
export type Snapshot = {
  id: string;
  selection: string;
  status: "partial" | "complete";
  source_count: string;
  revision: string;
};
export type Page = {
  snapshot: string;
  offset: number;
  count: number;
  label: string;
  sha256: string;
};
export function openData(root: string, readonly = false) {
  const path = join(root, "data.sqlite");
  if (!existsSync(path)) {
    ensure(!readonly, "missing source database");
    writeFileSync(path, "", { flag: "wx", mode: 0o600 });
  }
  const db = new Database(path, { readonly, strict: true });
  if (!readonly)
    db.exec(
      "PRAGMA foreign_keys=ON;" +
        definitions
          .map((s) => s.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "))
          .join(";"),
    );
  return db;
}
export function selectedURL(url: string, where?: string) {
  if (where === undefined) return url;
  const u = new URL(url);
  u.searchParams.set("$where", where);
  return u.href;
}
export function readOriginal(
  db: Database,
  root: string,
  run: string,
  label: string,
  expectedURL?: string,
): { text: string; sha256: string } {
  const row = db
    .query<Record<string, any>, [string, string]>(
      "SELECT * FROM observations WHERE run=? AND label=?",
    )
    .get(run, label);
  ensure(
    row && row.kind === "text" && (!expectedURL || row.url === expectedURL),
    "missing/mismatched source original",
  );
  const path = join(root, "transport", row.path),
    retained = existsSync(path) ? path : path + ".pending";
  const bytes = readFileSync(retained);
  ensure(hash(bytes) === row.sha256, "source checksum mismatch");
  return { text: bytes.toString(), sha256: row.sha256 };
}
function verifyRow(
  saved: Record<string, any>,
  row: ReturnType<typeof decodeRows>[number],
  ordinal: number,
) {
  ensure(
    saved.ordinal === ordinal &&
      saved.source_id === row.id &&
      saved.source_json === row.raw &&
      saved.value_json === JSON.stringify(row.value),
    "row derivation/provenance mismatch",
  );
}
function verifyPage(
  db: Database,
  transport: Database,
  root: string,
  snapshot: Snapshot,
  page: Page,
  expectedOffset: number,
) {
  const options = JSON.parse(snapshot.selection),
    selected = selection(options);
  ensure(
    Number.isSafeInteger(page.offset) &&
      page.offset === expectedOffset &&
      page.label === `page:${page.offset}`,
    "page offset/history mismatch",
  );
  const cap = Math.min(
    selected.pageSize,
    Number(BigInt(snapshot.source_count) - BigInt(page.offset)),
  );
  const raw = readOriginal(
    transport,
    root,
    snapshot.id,
    page.label,
    selectedURL(resourceURL(selected.asset, page.offset, cap), options.where),
  );
  const rows = decodeRows(raw.text);
  ensure(
    raw.sha256 === page.sha256 &&
      rows.length === page.count &&
      rows.length > 0 &&
      rows.length <= cap,
    "page count/hash mismatch",
  );
  const stored = db
    .query<Record<string, any>, [string, number]>(
      "SELECT * FROM source_rows WHERE snapshot=? AND page_offset=? ORDER BY ordinal",
    )
    .all(snapshot.id, page.offset);
  ensure(stored.length === rows.length, "row inventory mismatch");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!,
      saved = stored[i]!;
    verifyRow(saved, row, page.offset + i);
  }
  return rows.length;
}
function verifySnapshot(
  db: Database,
  transport: Database,
  root: string,
  snapshot: Snapshot,
) {
  const options = JSON.parse(snapshot.selection),
    selected = selection(options),
    saved = transport
      .query<{ options: string }, [string]>(
        "SELECT options FROM acquisition_options WHERE run=?",
      )
      .get(snapshot.id);
  ensure(
    saved &&
      JSON.stringify(JSON.parse(saved.options).selection) ===
        snapshot.selection,
    "immutable selection binding mismatch",
  );
  const catalog = decodeCatalog(
    readOriginal(
      transport,
      root,
      snapshot.id,
      "catalog",
      catalogURL({ asset: selected.asset, limit: 1, offset: 0 }),
    ).text,
    1,
  );
  ensure(
    catalog.assets.length === 1 && catalog.assets[0]!.id === selected.asset,
    "catalog membership mismatch",
  );
  const schema = decodeSchema(
    readOriginal(
      transport,
      root,
      snapshot.id,
      "schema-start",
      schemaURL(selected.asset),
    ).text,
    selected.asset,
  );
  const count = decodeCount(
    readOriginal(
      transport,
      root,
      snapshot.id,
      "count-start",
      selectedURL(countURL(selected.asset), options.where),
    ).text,
  );
  ensure(
    snapshot.source_count === count && snapshot.revision === revision(schema),
    "snapshot source metadata mismatch",
  );
  ensure(
    BigInt(count) <= BigInt(selected.maxRows),
    "retained selection exceeds bound",
  );
  let offset = 0;
  for (const page of db
    .query<Page, [string]>(
      "SELECT * FROM pages WHERE snapshot=? ORDER BY offset",
    )
    .all(snapshot.id))
    offset += verifyPage(db, transport, root, snapshot, page, offset);
  const stored = db
    .query<{ n: number }, [string]>(
      "SELECT count(*) AS n FROM source_rows WHERE snapshot=?",
    )
    .get(snapshot.id)!.n;
  ensure(
    stored === offset && BigInt(offset) <= BigInt(count),
    "row history count mismatch",
  );
  if (snapshot.status === "complete") {
    ensure(
      BigInt(offset) === BigInt(count),
      "incomplete rows cannot be complete",
    );
    ensure(
      decodeRows(
        readOriginal(
          transport,
          root,
          snapshot.id,
          "page:end",
          selectedURL(resourceURL(selected.asset, offset, 1), options.where),
        ).text,
      ).length === 0,
      "terminal page mismatch",
    );
    const final = decodeSchema(
      readOriginal(
        transport,
        root,
        snapshot.id,
        "schema-end",
        schemaURL(selected.asset),
      ).text,
      selected.asset,
    );
    ensure(
      revision(final) === snapshot.revision &&
        decodeCount(
          readOriginal(
            transport,
            root,
            snapshot.id,
            "count-end",
            selectedURL(countURL(selected.asset), options.where),
          ).text,
        ) === count,
      "completed source changed",
    );
  }
  return offset;
}
function verifyDomain(root: string, hasSource: boolean) {
  const path = join(root, "transport", "state.sqlite");
  if (!existsSync(path)) return;
  const db = new Database(path, { readonly: true, strict: true });
  try {
    verifyOperations(db);
    if (!hasSource)
      ensure(
        !db
          .query("SELECT 1 FROM observations WHERE label LIKE 'page:%' LIMIT 1")
          .get(),
        "missing source database with retained pages",
      );
  } finally {
    db.close();
  }
}
function rootInventory(root: string) {
  if (existsSync(root)) {
    ensure(lstatSync(root).isDirectory(), "archive root must be a directory");
    for (const name of readdirSync(root))
      ensure(
        name === "transport" || /^data\.sqlite(?:-wal|-shm)?$/.test(name),
        "unknown artifact or archive locked; manual owner review required",
      );
  }
}
export function verifyData(root: string) {
  rootInventory(root);
  transportPreflight(join(root, "transport"));
  const path = join(root, "data.sqlite");
  verifyDomain(root, existsSync(path));
  if (!existsSync(path)) return { snapshots: 0, rows: 0, complete: 0 };
  const stat = lstatSync(path);
  ensure(
    stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    "unsafe/private source database required",
  );
  const db = openData(root, true),
    transport = new Database(join(root, "transport", "state.sqlite"), {
      readonly: true,
      strict: true,
    });
  try {
    validateDefinitions(db, definitions, "foreign source schema");
    ensure(
      db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()
        ?.integrity_check === "ok" &&
        !db.query("PRAGMA foreign_key_check").get(),
      "source SQLite integrity failed",
    );
    const snapshots = db
      .query<Snapshot, []>("SELECT * FROM snapshots ORDER BY rowid")
      .all();
    let rows = 0;
    for (const snapshot of snapshots)
      rows += verifySnapshot(db, transport, root, snapshot);
    return {
      snapshots: snapshots.length,
      rows,
      complete: snapshots.filter((s) => s.status === "complete").length,
    };
  } finally {
    db.close();
    transport.close();
  }
}
export function savePage(
  db: Database,
  snapshot: string,
  offset: number,
  rows: ReturnType<typeof decodeRows>,
  label: string,
  sha256: string,
) {
  db.transaction(() => {
    db.query("INSERT INTO pages VALUES(?,?,?,?,?)").run(
      snapshot,
      offset,
      rows.length,
      label,
      sha256,
    );
    const insert = db.query("INSERT INTO source_rows VALUES(?,?,?,?,?,?)");
    rows.forEach((row, i) =>
      insert.run(
        snapshot,
        offset + i,
        offset,
        row.id,
        row.raw,
        JSON.stringify(row.value),
      ),
    );
  }).immediate();
}
