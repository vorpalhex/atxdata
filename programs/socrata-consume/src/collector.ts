import { catalogDecision, saveDecision, finishResult } from "./decision";
import { Database } from "bun:sqlite";
import { type Dependencies } from "../../arcgis-consume/src/archive";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Session, budget, safePath, type Budget } from "./transport";
import {
  origin,
  catalogOrigin,
  ensure,
  object,
  positive,
  selection,
  assetID,
  decodeRows,
  resourceURL,
} from "./source";
import {
  catalogURL,
  decodeCatalog,
  decodeAssetCatalog,
  schemaURL,
  decodeSchema,
  revision,
  countURL,
  decodeCount,
} from "./catalog";
import {
  openData,
  savePage,
  verifyData,
  selectedURL,
  type Snapshot,
} from "./data";
export type CollectOptions = {
  root: string;
  asset?: string;
  preset?: string;
  where?: string;
  maxRows: number;
  pageSize?: number;
  refresh?: boolean;
  resume?: boolean;
  budget?: Partial<Budget>;
  timeoutMs?: number;
};
type Common = {
  root: string;
  refresh?: boolean;
  budget?: Partial<Budget>;
  timeoutMs?: number;
};
function where(value: unknown): string | undefined {
  if (value === undefined) return;
  ensure(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 8000 &&
      !/[\x00-\x1f\x7f]/.test(value),
    "invalid where expression",
  );
  return value;
}
function rootPreflight(root: string) {
  safePath(root);
  return verifyData(root);
}
async function withSession<T>(
  options: Common,
  deps: Partial<Dependencies>,
  action: (session: Session) => Promise<T>,
) {
  budget(options.budget);
  if (options.timeoutMs !== undefined) positive(options.timeoutMs, "timeoutMs");
  rootPreflight(options.root);
  const s = await Session.open(options.root, deps, options.timeoutMs);
  let result: T;
  try {
    result = await action(s);
  } finally {
    await s.close();
  }
  rootPreflight(options.root);
  return result;
}
async function request(
  s: Session,
  run: string,
  label: string,
  url: string,
  validate: (text: string) => unknown,
) {
  return s.request(run, label, url, validate);
}
async function catalog(s: Session, run: string, id: string) {
  const url = catalogURL({ asset: id, limit: 1, offset: 0 });
  const text = await request(s, run, "catalog", url, decodeAssetCatalog);
  const decision = catalogDecision(s.archive.store.db, s.archive.root, run, id);
  saveDecision(s.archive.store.db, run, decision);
  if (decision.outcome === "member-absent") {
    s.archive.store.finish(
      run,
      "failed",
      "asset absent from Austin dataset catalog",
      { catalogDecision: decision },
    );
    throw Error("asset absent from Austin dataset catalog");
  }
  return decodeCatalog(text, 1).assets[0]!;
}
async function schema(s: Session, run: string, id: string, label: string) {
  return decodeSchema(
    await request(s, run, label, schemaURL(id), (t) => decodeSchema(t, id)),
    id,
  );
}
async function count(
  s: Session,
  run: string,
  id: string,
  filter: string | undefined,
  label: string,
) {
  return decodeCount(
    await request(
      s,
      run,
      label,
      selectedURL(countURL(id), filter),
      decodeCount,
    ),
  );
}
export async function discover(
  options: Common & { query: string; limit: number; offset?: number },
  deps: Partial<Dependencies> = {},
) {
  const url = catalogURL({
    query: options.query,
    limit: options.limit,
    offset: options.offset ?? 0,
  });
  return withSession(options, deps, async (s) => {
    const run = s.start(
      "discover",
      {
        query: options.query,
        limit: options.limit,
        offset: options.offset ?? 0,
      },
      options.budget,
    );
    const text = await request(s, run, "catalog-search", url, (t) =>
      decodeCatalog(t, options.limit),
    );
    const result = decodeCatalog(text, options.limit);
    s.archive.store.finish(run, "succeeded", undefined, result);
    return {
      ...result,
      offset: options.offset ?? 0,
      catalogComplete:
        BigInt(result.total) <= BigInt(result.assets.length) && !options.offset,
    };
  });
}
export async function inspect(
  options: Common & { asset: string },
  deps: Partial<Dependencies> = {},
) {
  const id = assetID(options.asset);
  return withSession(options, deps, async (s) => {
    const run = s.start("inspect", { asset: id }, options.budget);
    await catalog(s, run, id);
    const result = await schema(s, run, id, "schema");
    s.archive.store.finish(
      run,
      "succeeded",
      undefined,
      finishResult(s.archive.store.db, run, { id }),
    );
    return result;
  });
}
function receipt(snapshot: Snapshot, rows: number, reused: boolean) {
  const options = JSON.parse(snapshot.selection);
  return {
    snapshot: snapshot.id,
    asset: options.asset,
    where: options.where ?? null,
    status: snapshot.status,
    rows,
    sourceCount: snapshot.source_count,
    wholeAsset: options.where === undefined,
    transactionalSnapshot: false,
    consistency:
      "count-and-revision-checked; concurrent changes may remain undetected",
    reused,
  };
}
function findSnapshot(root: string, key: string) {
  if (!existsSync(join(root, "data.sqlite"))) return;
  const target = JSON.parse(key);
  const db = openData(root, true);
  try {
    return db
      .query<Snapshot, []>("SELECT * FROM snapshots ORDER BY rowid DESC")
      .all()
      .find((row) => {
        const o = JSON.parse(row.selection);
        return o.asset === target.asset && o.where === target.where;
      });
  } finally {
    db.close();
  }
}
function reuse(s: Session, snapshot: Snapshot, options: CollectOptions) {
  const limits = budget(options.budget);
  const largest = s.archive.store.db
    .query<{ n: number }, [string]>(
      "SELECT max(bytes) AS n FROM observations WHERE run=?",
    )
    .get(snapshot.id)!.n;
  ensure(
    BigInt(snapshot.source_count) <= BigInt(options.maxRows) &&
      largest <= limits.responseBytes,
    "reuse exceeds current row/response bounds",
  );
  return receipt(snapshot, rowCount(s, snapshot.id), true);
}
function rowCount(s: Session, id: string) {
  const db = openData(s.root, true);
  try {
    return db
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM source_rows WHERE snapshot=?",
      )
      .get(id)!.n;
  } finally {
    db.close();
  }
}
async function fresh(
  s: Session,
  options: CollectOptions,
  key: string,
  selected: ReturnType<typeof selection>,
) {
  const run = s.start(
    "collect",
    { selection: JSON.parse(key) },
    options.budget,
  );
  await catalog(s, run, selected.asset);
  const initial = await schema(s, run, selected.asset, "schema-start"),
    total = await count(s, run, selected.asset, options.where, "count-start");
  ensure(
    BigInt(total) <= BigInt(selected.maxRows),
    "selection count exceeds maxRows; narrow --where or raise bound",
  );
  const snapshot: Snapshot = {
    id: run,
    selection: key,
    status: "partial",
    source_count: total,
    revision: revision(initial),
  };
  const db = openData(s.root);
  try {
    db.query("INSERT INTO snapshots VALUES(?,?,?,?,?)").run(
      run,
      key,
      "partial",
      total,
      snapshot.revision,
    );
  } finally {
    db.close();
  }
  return snapshot;
}
async function revalidate(
  s: Session,
  snapshot: Snapshot,
  options: CollectOptions,
) {
  const selected = selection(JSON.parse(snapshot.selection)),
    check = crypto.randomUUID();
  const latest = await schema(
    s,
    snapshot.id,
    selected.asset,
    `resume-schema:${check}`,
  );
  const total = await count(
    s,
    snapshot.id,
    selected.asset,
    options.where,
    `resume-count:${check}`,
  );
  ensure(
    revision(latest) === snapshot.revision && total === snapshot.source_count,
    "source changed; explicit refresh required",
  );
}
async function pages(s: Session, snapshot: Snapshot, options: CollectOptions) {
  const selected = selection(JSON.parse(snapshot.selection));
  let offset = rowCount(s, snapshot.id);
  while (BigInt(offset) < BigInt(snapshot.source_count)) {
    // Re-derive offset from retained rows immediately before every request.
    ensure(
      offset === rowCount(s, snapshot.id),
      "continuation row offset mismatch",
    );
    const limit = Math.min(
        selected.pageSize,
        Number(BigInt(snapshot.source_count) - BigInt(offset)),
      ),
      label = `page:${offset}`;
    const text = await request(
      s,
      snapshot.id,
      label,
      selectedURL(resourceURL(selected.asset, offset, limit), options.where),
      (t) => {
        const n = decodeRows(t).length;
        ensure(
          n > 0 && n <= limit,
          "empty/oversized page; source changed or pagination unsupported",
        );
      },
    );
    const rows = decodeRows(text),
      observation = s.archive.store.observation(snapshot.id, label)!;
    const db = openData(s.root);
    try {
      savePage(db, snapshot.id, offset, rows, label, observation.sha256);
    } finally {
      db.close();
    }
    offset += rows.length;
  }
  await request(
    s,
    snapshot.id,
    "page:end",
    selectedURL(resourceURL(selected.asset, offset, 1), options.where),
    (t) =>
      ensure(
        decodeRows(t).length === 0,
        "nonempty terminal page; source changed",
      ),
  );
  const final = await schema(s, snapshot.id, selected.asset, "schema-end"),
    total = await count(
      s,
      snapshot.id,
      selected.asset,
      options.where,
      "count-end",
    );
  ensure(
    revision(final) === snapshot.revision && total === snapshot.source_count,
    "source changed during traversal; refresh required",
  );
  const db = openData(s.root);
  try {
    db.query("UPDATE snapshots SET status='complete' WHERE id=?").run(
      snapshot.id,
    );
  } finally {
    db.close();
  }
  snapshot.status = "complete";
  s.archive.store.finish(
    snapshot.id,
    "succeeded",
    undefined,
    finishResult(
      s.archive.store.db,
      snapshot.id,
      receipt(snapshot, offset, false),
    ),
  );
  return receipt(snapshot, offset, false);
}
function resumeBounds(options: CollectOptions, key: string) {
  if (!options.resume) return options;
  rootPreflight(options.root);
  const snapshot = findSnapshot(options.root, key);
  if (!snapshot || snapshot.status === "complete") return options;
  const db = new Database(join(options.root, "transport", "state.sqlite"), {
    readonly: true,
  });
  try {
    const row = db
      .query<{ options: string }, [string]>(
        "SELECT options FROM acquisition_options WHERE run=?",
      )
      .get(snapshot.id)!;
    const saved = JSON.parse(row.options);
    for (const [name, value] of Object.entries(options.budget ?? {}))
      ensure(
        value === saved.budget[name],
        `resume budget ${name} differs from frozen limit`,
      );
    ensure(
      options.timeoutMs === undefined || options.timeoutMs === saved.timeoutMs,
      "resume timeout differs from frozen limit",
    );
    return { ...options, timeoutMs: saved.timeoutMs };
  } finally {
    db.close();
  }
}
function flags(options: CollectOptions) {
  ensure(!(options.refresh && options.resume), "refresh conflicts with resume");
  for (const key of ["refresh", "resume"] as const)
    ensure(
      options[key] === undefined || typeof options[key] === "boolean",
      `invalid ${key}`,
    );
}
export async function collect(
  options: CollectOptions,
  deps: Partial<Dependencies> = {},
) {
  const selected = selection(options),
    filter = where(options.where);
  flags(options);
  const key = JSON.stringify({
    ...selected,
    ...(filter === undefined ? {} : { where: filter }),
  });
  budget(options.budget);
  options = resumeBounds(options, key);
  return withSession(options, deps, async (s) => {
    let snapshot = findSnapshot(s.root, key);
    if (snapshot?.status === "complete" && !options.refresh)
      return reuse(s, snapshot, options);
    ensure(
      !options.resume || snapshot,
      "no matching partial selection to resume",
    );
    if (snapshot && !options.refresh) {
      ensure(
        options.resume,
        "partial selection exists; use --resume or --refresh",
      );
      ensure(
        snapshot.selection === key,
        "resume selection differs from frozen row/page bounds",
      );
      s.archive.store.resume(snapshot.id, "socrata:austin", "collect");
      await revalidate(s, snapshot, options);
    } else snapshot = await fresh(s, options, key, selected);
    return pages(s, snapshot, options);
  });
}
export async function status(root: string) {
  safePath(root);
  return { ...verifyData(root), httpRequests: 0 };
}
export async function verify(root: string) {
  safePath(root);
  return { integrity: "ok", ...verifyData(root), httpRequests: 0 };
}
