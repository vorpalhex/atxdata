import type { Archive } from "./archive";
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { ensure, object } from "./check";
import { captureText } from "./app-capture";
import { validateAppCheckpoint, type AppRun } from "./app-intent";
const label = "app-data";
export const emptySHA = createHash("sha256").update("").digest("hex");
function headerValues(raw: string) {
  const v = object(JSON.parse(raw));
  ensure(
    Object.values(v).every((x) => typeof x === "string"),
    "invalid app-data header values",
  );
  ensure(raw.length <= 16384, "app-data headers exceed representation bound");
  return new Headers(v as Record<string, string>);
}
export function emptyHeaders(raw: string, status: number) {
  ensure(status === 200, "raw-empty requires exact HTTP200");
  const h = headerValues(raw);
  ensure(
    ![
      "www-authenticate",
      "proxy-authenticate",
      "location",
      "cf-mitigated",
      "x-amzn-waf-action",
      "x-captcha",
    ].some((k) => h.has(k)),
    "raw-empty authentication/challenge/redirect marker",
  );
  const type = (h.get("content-type") ?? "").toLowerCase().trim();
  ensure(
    /^(text\/plain|application\/json|text\/json)(\s*;\s*charset\s*=\s*utf-8)?$/.test(
      type,
    ),
    "raw-empty unsupported media type",
  );
  ensure(
    !h.has("content-encoding") ||
      h.get("content-encoding")?.toLowerCase() === "identity",
    "raw-empty ambiguous content encoding",
  );
  const length = h.get("content-length"),
    transfer = h.get("transfer-encoding")?.toLowerCase();
  ensure(
    (length === "0" && transfer === undefined) ||
      (length === null && transfer === "chunked"),
    "raw-empty requires unambiguous zero length or terminated chunked framing",
  );
}
type Producer = {
  id: string;
  run: string;
  label: string;
  url: string;
  status: number;
  finished: string | null;
  error: string | null;
  bytes: number;
  headers: string;
};
function intent(a: Archive, run: string) {
  const row = a.store.db
    .query<AppRun, [string]>(
      "SELECT id,source,command,status,summary FROM runs WHERE id=?",
    )
    .get(run);
  ensure(row, "missing app run");
  const s = validateAppCheckpoint(row, a.store.options(run));
  ensure(
    s.receiptVersion === 2,
    "empty representation requires saved v2 intent",
  );
}
function freshEmpty(a: Archive, run: string, url: string, before: Set<string>) {
  intent(a, run);
  const rows = a.store.db
    .query<Producer, [string, string]>(
      "SELECT * FROM attempts WHERE run=? AND label=?",
    )
    .all(run, label);
  ensure(
    rows.length === 1 && !before.has(rows[0]!.id),
    "raw-empty requires one newly dispatched producer",
  );
  const row = rows[0]!;
  ensure(
    row.run === run && row.label === label && row.url === url,
    "raw-empty fresh producer identity mismatch",
  );
  emptyHeaders(row.headers, row.status);
}
type DataObservation = {
  run: string;
  label: string;
  url: string;
  kind: string;
  status: string;
  path: string;
  bytes: number;
  sha256: string;
};
function readyObservation(db: Database, run: string, url: string) {
  const o = db
    .query<DataObservation, [string, string]>(
      "SELECT * FROM observations WHERE run=? AND label=?",
    )
    .get(run, label);
  ensure(
    o &&
      o.run === run &&
      o.url === url &&
      o.kind === "text" &&
      o.status === "ready",
    "v2 app-data ready receipt missing",
  );
  return o;
}
function successfulProducer(
  db: Database,
  run: string,
  url: string,
  o: DataObservation,
) {
  const rows = db
    .query<Producer, [string, string]>(
      "SELECT * FROM attempts WHERE run=? AND label=?",
    )
    .all(run, label);
  ensure(rows.length === 1, "v2 app-data producer is not unique");
  const p = rows[0]!;
  ensure(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(p.id),
    "v2 producer identifier is not canonical",
  );
  ensure(
    p.url === url &&
      p.run === run &&
      p.label === label &&
      o.path === p.id + ".body",
    "v2 app-data producer identity mismatch",
  );
  ensure(
    p.status === 200 &&
      typeof p.finished === "string" &&
      p.error === null &&
      p.bytes === o.bytes,
    "v2 app-data successful producer binding missing",
  );
  return p;
}
export function v2Receipt(
  db: Database,
  run: string,
  url: string,
  representation: string,
) {
  const o = readyObservation(db, run, url),
    p = successfulProducer(db, run, url, o);
  if (representation === "empty-body") {
    ensure(
      o.bytes === 0 && o.sha256 === emptySHA,
      "v2 empty body size/hash mismatch",
    );
    emptyHeaders(p.headers, p.status);
  } else
    ensure(
      representation === "json" && o.bytes > 0,
      "v2 JSON representation size mismatch",
    );
  return {
    receiptVersion: 2,
    representation,
    attempt: p.id,
    label,
    url,
    status: p.status,
    bytes: o.bytes,
    sha256: o.sha256,
    headersSha256: createHash("sha256").update(p.headers).digest("hex"),
  };
}

function requirePolicy(a: Archive, run: string) {
  const p = a.store.observation(run, "robots-www.arcgis.com");
  ensure(
    p &&
      p.url === "https://www.arcgis.com/robots.txt" &&
      p.kind === "text" &&
      p.status === "ready" &&
      p.bytes > 0,
    "v2 requires nonempty retained Portal policy",
  );
}
function validateRepresentation(
  a: Archive,
  run: string,
  url: string,
  before: Set<string>,
  cached: boolean,
  text: string,
) {
  if (text.length > 0) {
    JSON.parse(text);
    return;
  }
  if (cached) {
    v2Receipt(a.store.db, run, url, "empty-body");
    return;
  }
  freshEmpty(a, run, url, before);
}
export async function readV2AppData(
  a: Archive,
  run: string,
  url: string,
  offline: boolean,
) {
  intent(a, run);
  requirePolicy(a, run);
  const old = a.store.observation(run, label);
  if (old) ensure(old.status === "ready", "v2 cannot adopt pending app-data");
  const before = new Set(
    a.store.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM attempts WHERE run=? AND label=?",
      )
      .all(run, label)
      .map((x) => x.id),
  );
  const raw = await captureText(a, run, label, url, offline, (text) =>
    validateRepresentation(a, run, url, before, Boolean(old), text),
  );
  const representation = raw.length === 0 ? "empty-body" : "json";
  const receipt = v2Receipt(a.store.db, run, url, representation);
  const retained = String(await a.readExpected(run, label, url, "text"));
  ensure(retained === raw, "v2 ready body changed after capture");
  return representation === "empty-body"
    ? { representation: "empty-body" as const, receipt, value: undefined }
    : { representation: "json" as const, receipt, value: JSON.parse(raw) };
}
