import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogURL, decodeAssetCatalog } from "./catalog";
import { assetID, ensure, object, origin, operationFormat } from "./source";
type Row = Record<string, any>;
function producer(db: Database, run: string, observation: Row, url: string) {
  const attempt = db
    .query<Row, [string]>("SELECT * FROM attempts WHERE id=?")
    .get(observation.path.slice(0, -5));
  ensure(
    attempt &&
      attempt.run === run &&
      attempt.label === "catalog" &&
      attempt.url === url,
    "catalog decision producer mismatch",
  );
  ensure(
    attempt.status === 200 && attempt.finished && attempt.error === null,
    "catalog decision producer incomplete",
  );
  return attempt;
}
export function catalogDecision(
  db: Database,
  root: string,
  run: string,
  requested: string,
) {
  const asset = assetID(requested);
  const url = catalogURL({ asset, limit: 1, offset: 0 });
  const observation = db
    .query<Row, [string]>(
      "SELECT * FROM observations WHERE run=? AND label='catalog'",
    )
    .get(run);
  ensure(
    observation && observation.url === url && observation.status === "ready",
    "missing catalog decision observation",
  );
  const attempt = producer(db, run, observation, url);
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(readFileSync(join(root, observation.path)));
  const catalog = decodeAssetCatalog(text);
  return {
    format: "socrata-catalog-membership-v1",
    source: "socrata:austin",
    sourceURL: origin,
    asset,
    catalogURL: url,
    run,
    attempt: attempt.id,
    path: observation.path,
    sha256: observation.sha256,
    count: catalog.assets.length,
    total: catalog.total,
    outcome: catalog.assets.some((entry) => entry.id === asset)
      ? "member-present"
      : "member-absent",
  };
}
export function saveDecision(
  db: Database,
  run: string,
  decision: ReturnType<typeof catalogDecision>,
) {
  db.query(
    "UPDATE runs SET summary=? WHERE id=? AND status='running' AND summary IS NULL",
  ).run(JSON.stringify({ catalogDecision: decision }), run);
}
export function finishResult(db: Database, run: string, result: unknown) {
  const row = db
    .query<Row, [string]>("SELECT summary FROM runs WHERE id=?")
    .get(run);
  return { ...JSON.parse(row?.summary ?? "{}"), result };
}
export function verifyDecision(
  db: Database,
  root: string,
  run: Row,
  options: Row,
) {
  if (options.format !== operationFormat) {
    legacySummary(run);
    return;
  }
  if (run.command === "discover") return;
  const observation = db
    .query("SELECT 1 FROM observations WHERE run=? AND label='catalog'")
    .get(run.id);
  if (!observation) {
    ensure(
      run.summary === null && run.status !== "succeeded",
      "missing catalog decision observation",
    );
    return;
  }
  const asset =
    run.command === "inspect" ? options.asset : object(options.selection).asset;
  const expected = catalogDecision(db, root, run.id, assetID(asset));
  const summary = object(JSON.parse(run.summary ?? "null"));
  const actual = object(summary.catalogDecision);
  ensure(
    Object.keys(actual).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) => actual[key] === value),
    "catalog decision binding mismatch",
  );
  if (expected.outcome === "member-absent") {
    negativeTerminal(db, run, summary);
  }
}
function legacySummary(run: Row) {
  if (run.summary === null) return;
  ensure(
    !Object.hasOwn(object(JSON.parse(run.summary)), "catalogDecision"),
    "catalog decision format mismatch",
  );
}
function negativeTerminal(db: Database, run: Row, summary: Row) {
  ensure(
    run.status === "failed" &&
      typeof run.error === "string" &&
      !Object.hasOwn(summary, "result"),
    "catalog negative terminal outcome mismatch",
  );
  ensure(
    !db
      .query(
        "SELECT 1 FROM attempts WHERE run=? AND label NOT IN ('catalog',?)",
      )
      .get(run.id, `robots:${new URL(origin).hostname}`),
    "asset request after catalog negative",
  );
}
