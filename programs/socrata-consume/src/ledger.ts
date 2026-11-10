import { Database } from "bun:sqlite";
import {
  ensure,
  object,
  selection,
  assetID,
  origin,
  catalogOrigin,
  positive,
  validateIdentity,
} from "./source";
import { catalogURL, schemaURL, countURL } from "./catalog";
import { budget } from "./transport";
type Row = Record<string, any>;
function keys(value: Row, required: string[], optional: string[] = []) {
  ensure(
    required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every(
        (key) => required.includes(key) || optional.includes(key),
      ),
    "operation fields mismatch",
  );
}
function selected(value: unknown) {
  const o = object(value);
  keys(o, ["asset", "maxRows", "pageSize"], ["where"]);
  selection(o);
  if (o.where !== undefined)
    ensure(
      typeof o.where === "string" && o.where.length > 0,
      "operation WHERE mismatch",
    );
  return o;
}
function options(command: string, value: unknown) {
  const o = object(value),
    common = ["format", "representation", "timeoutMs", "budget"];
  validateIdentity(o.format);
  ensure(
    o.representation === "fetch-decoded-body",
    "operation version mismatch",
  );
  positive(o.timeoutMs, "operation timeout");
  budget(object(o.budget));
  switch (command) {
    case "collect":
      keys(o, [...common, "selection"]);
      selected(o.selection);
      break;
    case "inspect":
      keys(o, [...common, "asset"]);
      assetID(o.asset);
      break;
    case "discover":
      keys(o, [...common, "query", "limit", "offset"]);
      catalogURL(o as { query: string; limit: number; offset: number });
      break;
    default:
      throw Error("unsupported operation command");
  }
  return o;
}
function filtered(url: string, where: unknown) {
  if (where === undefined) return url;
  const u = new URL(url);
  u.searchParams.set("$where", String(where));
  return u.href;
}
function collectURL(o: Row, label: string, actual: string) {
  const s = selected(o.selection),
    id = assetID(s.asset);
  if (label === "catalog")
    return catalogURL({ asset: id, limit: 1, offset: 0 });
  if (
    label === "schema-start" ||
    label === "schema-end" ||
    /^resume-schema:[a-f0-9-]{36}$/.test(label)
  )
    return schemaURL(id);
  if (
    label === "count-start" ||
    label === "count-end" ||
    /^resume-count:[a-f0-9-]{36}$/.test(label)
  )
    return filtered(countURL(id), s.where);
  return pageURL(s, label, actual);
}
function pageURL(s: Record<string, unknown>, label: string, actual: string) {
  const id = assetID(s.asset);
  ensure(
    /^page:(?:end|0|[1-9]\d*)$/.test(label),
    "operation page label mismatch",
  );
  const url = new URL(actual),
    offset = url.searchParams.get("$offset"),
    limit = url.searchParams.get("$limit");
  ensure(
    offset !== null &&
      /^(0|[1-9]\d*)$/.test(offset) &&
      Number.isSafeInteger(Number(offset)),
    "operation page offset",
  );
  ensure(
    limit !== null &&
      /^[1-9]\d*$/.test(limit) &&
      Number(limit) <= Number(s.pageSize),
    "operation page limit",
  );
  if (label !== "page:end")
    ensure(label === `page:${offset}`, "operation page ordinal mismatch");
  const expected = new URL(`${origin}/resource/${id}.json`);
  expected.search = new URLSearchParams({
    $select: "*, :id",
    $order: ":id",
    $offset: offset,
    $limit: limit,
  }).toString();
  return filtered(expected.href, s.where);
}
function expectedURL(run: Row, o: Row, label: string, actual: string): string {
  if (label === `robots:${new URL(origin).hostname}`)
    return origin + "/robots.txt";
  if (run.command === "collect") return collectURL(o, label, actual);
  if (run.command === "discover") {
    ensure(label === "catalog-search", "operation discovery label mismatch");
    return catalogURL(o as { query: string; limit: number; offset: number });
  }
  ensure(
    label === "catalog" || label === "schema",
    "operation inspect label mismatch",
  );
  return label === "catalog"
    ? catalogURL({ asset: assetID(o.asset), limit: 1, offset: 0 })
    : schemaURL(assetID(o.asset));
}
function attempts(db: Database, run: Row, o: Row) {
  const bounds = budget(o.budget),
    rows = db
      .query<Row, [string]>("SELECT * FROM attempts WHERE run=? ORDER BY rowid")
      .all(run.id);
  ensure(rows.length <= bounds.requests, "operation request budget mismatch");
  let bytes = 0;
  for (const a of rows) {
    ensure(
      a.url === expectedURL(run, o, a.label, a.url),
      "operation request URL mismatch",
    );
    positive(a.bytes, "operation bytes", 0);
    bytes += a.bytes;
    if (a.error !== "response byte ceiling exceeded")
      ensure(
        a.bytes <= bounds.responseBytes,
        "operation response budget mismatch",
      );
  }
  if (!rows.some((a) => a.error === "response byte ceiling exceeded"))
    ensure(
      bytes <= bounds.totalBytes,
      "operation aggregate byte budget mismatch",
    );
}
function runState(run: Row) {
  ensure(
    run.source === "socrata:austin" &&
      ["running", "succeeded", "failed"].includes(run.status),
    "operation source/status mismatch",
  );
  ensure(
    typeof run.started === "string" && Number.isFinite(Date.parse(run.started)),
    "operation start mismatch",
  );
  if (run.status === "running")
    ensure(
      run.finished === null && run.error === null && run.summary === null,
      "operation unfinished state mismatch",
    );
  else
    ensure(
      typeof run.finished === "string" &&
        Date.parse(run.finished) >= Date.parse(run.started),
      "operation completion mismatch",
    );
}
export function verifyOperations(db: Database) {
  for (const source of db.query<Row, []>("SELECT * FROM sources").all())
    ensure(
      source.id === "socrata:austin" && source.original_url === origin,
      "operation publisher mismatch",
    );
  const runs = db.query<Row, []>("SELECT * FROM runs").all();
  for (const run of runs) {
    runState(run);
    const stored = db
      .query<{ options: string }, [string]>(
        "SELECT options FROM acquisition_options WHERE run=?",
      )
      .get(run.id);
    ensure(stored, "missing operation options");
    const o = options(run.command, JSON.parse(stored.options));
    attempts(db, run, o);
  }
  ensure(
    db
      .query<{ n: number }, []>("SELECT count(*) AS n FROM acquisition_options")
      .get()!.n === runs.length,
    "orphan operation options",
  );
}
