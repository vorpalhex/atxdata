import { admittedWrapperURL } from "./wrapper-contract";
import { type Database } from "bun:sqlite";
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ensure, object, same } from "./check";
import { validateAppCheckpoint, type AppRun } from "./app-intent";
import { validateV2Ready } from "./app-preopen";
import { itemUrl } from "./sources";
import {
  policyMode,
  policyKind,
  mapsPolicy,
  hubTarget,
  validatePolicyOptions,
  type PolicyOptions,
} from "./policy-inspection-contract";
export function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
export type Run = AppRun & { options: string | null };
export function policyRuns(db: Database) {
  return db
    .query<Run, []>(
      "SELECT r.id,r.source,r.command,r.status,r.summary,o.options FROM runs r LEFT JOIN acquisition_options o ON o.run=r.id ORDER BY r.rowid",
    )
    .all();
}
export async function body(
  root: string,
  path: string,
  size: number,
  sha: string,
  ceiling = 1000000,
) {
  ensure(
    /^[a-f0-9-]{36}\.body$/.test(path) &&
      Number.isSafeInteger(size) &&
      size >= 0 &&
      size <= ceiling,
    "unsafe policy body binding",
  );
  const p = join(root, path),
    st = await lstat(p);
  ensure(
    st.isFile() && !st.isSymbolicLink() && st.size === size,
    "policy body path/size mismatch",
  );
  const raw = await readFile(p);
  ensure(
    raw.length === size && hash(raw) === sha,
    "policy body checksum mismatch",
  );
  return raw;
}
type Observation = {
  run: string;
  label: string;
  url: string;
  kind: string;
  path: string;
  status: string;
  bytes: number;
  sha256: string;
};
type Attempt = {
  id: string;
  run: string;
  label: string;
  url: string;
  status: number;
  headers: string;
  bytes: number;
  finished: string | null;
  error: string | null;
};
export async function sourceBinding(
  db: Database,
  root: string,
  options: PolicyOptions,
  wrapper = false,
) {
  const r = policyRuns(db).find((r) => r.id === options.appRun);
  ensure(
    r && r.status === "succeeded" && r.options,
    "policy source run unavailable",
  );
  const intent = validateAppCheckpoint(r, JSON.parse(r.options));
  ensure(
    (wrapper || intent.receiptVersion === 2) &&
      intent.selection.item === options.item,
    "policy source intent mismatch",
  );
  if (intent.receiptVersion === 2) await validateV2Ready(db, root, r, intent);
  if (wrapper)
    ensure(
      r.summary &&
        !String(object(JSON.parse(r.summary)).outcome).startsWith("item-"),
      "wrapper requires matching catalog/app role and published URL",
    );
  const o = sourceObservation(db, r.id, options);
  const a = producer(db, o);
  ensure(a.status === 200, "policy source producer mismatch");
  const item = publishedItem(
    JSON.parse((await body(root, o.path, o.bytes, o.sha256)).toString()),
    options.item,
    wrapper,
  );
  return {
    ...(wrapper
      ? {
          termsSha256: intent.termsSha256,
          catalogTermsSha256: intent.catalogTermsSha256,
          appReceiptVersion: intent.receiptVersion,
        }
      : {}),
    appRun: r.id,
    item: options.item,
    appItemSha256: o.sha256,
    publishedURL: item.url,
    requestedOrigin: "https://maps.austintexas.gov",
    source: "austin",
  };
}
function sourceObservation(db: Database, run: string, options: PolicyOptions) {
  const o = db
    .query<Observation, [string]>(
      "SELECT * FROM observations WHERE run=? AND label='app-item'",
    )
    .get(run);
  ensure(
    o &&
      o.status === "ready" &&
      o.kind === "text" &&
      o.url === itemUrl(options.item) &&
      o.sha256 === options.appItemSha256,
    "policy source observation mismatch",
  );
  return o;
}
function producer(db: Database, o: Observation) {
  const a = db
    .query<Attempt, [string]>("SELECT * FROM attempts WHERE id=?")
    .get(o.path.slice(0, -5));
  ensure(
    a &&
      a.id + ".body" === o.path &&
      a.run === o.run &&
      a.label === o.label &&
      a.url === o.url &&
      a.error === null &&
      a.finished !== null &&
      a.bytes === o.bytes,
    "policy producer mismatch",
  );
  return a;
}
function publishedItem(value: unknown, id: string, wrapper = false) {
  const item = object(value);
  ensure(
    item.id === id &&
      item.type === "Web Mapping Application" &&
      item.access === "public" &&
      (wrapper
        ? admittedWrapperURL(item.url)
        : item.url === "https://maps.austintexas.gov/FloodPro/"),
    "policy inspection published source is outside approved route",
  );
  return item;
}
export function markedPolicy(db: Database, r: Run) {
  return (
    r.command === "inspect-policy" ||
    r.source.includes(":wrapper-policy-") ||
    Boolean(
      r.options &&
      /wrapper-policy-|policyReceiptVersion|policy-raw-v1/.test(r.options),
    ) ||
    Boolean(r.summary && /policyReceiptVersion/.test(r.summary)) ||
    Boolean(
      db
        .query(
          "SELECT 1 FROM observations WHERE run=? AND (kind=? OR label LIKE 'policy-hop-%') LIMIT 1",
        )
        .get(r.id, policyKind),
    )
  );
}
export function policyIntent(r: Run) {
  const s = object(JSON.parse(r.options ?? "null"));
  const options = validatePolicyOptions(s.selection);
  ensure(
    s.mode === policyMode &&
      s.policyReceiptVersion === 1 &&
      s.wireKind === policyKind &&
      s.source === "austin" &&
      same(s.budget, options.budget) &&
      r.command === "inspect-policy" &&
      r.source === `austin:${options.item}:${policyMode}`,
    "policy intent missing/downgraded",
  );
  return { options, s };
}
export async function hop(
  db: Database,
  root: string,
  run: string,
  index: number,
  url: string,
  cap: number,
) {
  return rawCapture(
    db,
    root,
    run,
    `policy-hop-${index}`,
    url,
    policyKind,
    cap,
    index,
  );
}
export async function rawCapture(
  db: Database,
  root: string,
  run: string,
  label: string,
  url: string,
  kind: string,
  cap: number,
  index = 0,
) {
  const o = rawObservation(db, run, label, url, cap, kind);
  const a = producer(db, o);
  ensure(a.status >= 200 && a.status <= 599, "policy producer status mismatch");
  return hopReceipt(
    db,
    root,
    o,
    a,
    index,
    kind === "app-reference-raw-v1" ? cap : 1000000,
  );
}
function rawObservation(
  db: Database,
  run: string,
  label: string,
  url: string,
  cap: number,
  kind: string = policyKind,
) {
  const rows = db
    .query<Attempt, [string, string]>(
      "SELECT * FROM attempts WHERE run=? AND label=? ORDER BY rowid",
    )
    .all(run, label);
  const o = db
    .query<Observation, [string, string]>(
      "SELECT * FROM observations WHERE run=? AND label=?",
    )
    .get(run, label);
  ensure(
    rows.length === 1 &&
      o &&
      o.run === run &&
      o.label === label &&
      o.url === url &&
      o.kind === kind &&
      o.status === "ready" &&
      o.bytes <= cap,
    "policy observation missing/downgraded",
  );
  ensure(rows[0]!.id + ".body" === o.path, "policy producer mismatch");
  return o;
}
async function hopReceipt(
  db: Database,
  root: string,
  o: Observation,
  a: Attempt,
  index: number,
  ceiling = 1000000,
) {
  const raw = await body(root, o.path, o.bytes, o.sha256, ceiling),
    headers = new Headers(
      object(JSON.parse(a.headers)) as Record<string, string>,
    );
  const timing = db
    .query<
      {
        phase: string;
        clock_ms: number;
        wall_ms: number;
        until_ms: number;
        domain: string;
      },
      [string]
    >(
      "SELECT phase,clock_ms,wall_ms,until_ms,domain FROM timing_events WHERE attempt=? ORDER BY rowid",
    )
    .all(a.id);
  ensure(
    ["reserve", "dispatch", "headers", "checkpoint", "complete"].every(
      (p) => timing.filter((e) => e.phase === p).length === 1,
    ),
    "policy completion timing missing",
  );
  const header = timing.find((t) => t.phase === "headers")!;
  const location = headers.get("location");
  const receipt = {
    index,
    label: o.label,
    url: o.url,
    attempt: a.id,
    status: a.status,
    headerSha256: hash(a.headers),
    location: location === hubTarget ? location : null,
    locationSha256: location === null ? null : hash(location),
    sha256: o.sha256,
    bytes: o.bytes,
    wireKind: o.kind,
    timing,
  };
  return {
    receipt,
    raw,
    headers,
    location,
    serverHold: header.until_ms > header.clock_ms,
  };
}
export type Hop = Awaited<ReturnType<typeof hop>>;
export function classify(h: Hop, index: number) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(h.raw);
  } catch {
    return "binary-not-policy";
  }
  if (
    ["www-authenticate", "proxy-authenticate", "cf-mitigated"].some((k) =>
      h.headers.has(k),
    ) ||
    /captcha|cf-chl-|access denied|verify you are human/i.test(text)
  )
    return "challenge-or-denial";
  if (h.serverHold) return "server-hold";
  return (
    classifyStatus(h, index) ??
    classifyText(text, h.headers.get("content-type") ?? "")
  );
}
function classifyStatus(h: Hop, index: number) {
  const status = h.receipt.status;
  if (status === 401 || status === 403) return "access-denied";
  if (status >= 400) return "http-error";
  if (status === 301 || status === 302)
    return index === 0 && h.location === hubTarget
      ? "redirect"
      : "redirect-unapproved";
  if (status !== 200) return "unsupported-status";
  return undefined;
}
function classifyText(text: string, contentType: string) {
  if (/<(?:!doctype|html)/i.test(text) || /html/i.test(contentType))
    return "html-not-policy";
  if (!/^text\/plain(?:;|$)/i.test(contentType)) return "non-policy-media";
  return /^\s*user-agent\s*:/im.test(text)
    ? "robots-text-inspected"
    : "non-policy-text";
}
export async function policySummary(db: Database, root: string, r: Run) {
  const { options, s } = policyIntent(r),
    binding = await sourceBinding(db, root, options);
  ensure(same(binding, s.binding), "policy source binding changed");
  const first = await hop(
    db,
    root,
    r.id,
    0,
    mapsPolicy,
    options.budget.responseBytes,
  );
  let outcome = classify(first, 0);
  const chain = [first.receipt];
  if (outcome === "redirect") {
    const second = await hop(
      db,
      root,
      r.id,
      1,
      hubTarget,
      options.budget.responseBytes,
    );
    chain.push(second.receipt);
    outcome = classify(second, 1);
  }
  const attempts = db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) n FROM attempts WHERE run=?",
    )
    .get(r.id)!.n;
  const observations = db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) n FROM observations WHERE run=?",
    )
    .get(r.id)!.n;
  ensure(
    attempts === chain.length &&
      observations === chain.length &&
      attempts <= options.budget.requests &&
      chain.reduce((n, h) => n + h.bytes, 0) <= options.budget.totalBytes,
    "policy chain/budget mismatch",
  );
  return {
    mode: policyMode,
    policyReceiptVersion: 1,
    wireKind: policyKind,
    binding,
    permission: false,
    navigation: false,
    metadataOnly: true,
    wrapperResolved: false,
    acquiredFeatures: false,
    acquiredFiles: false,
    outcome,
    chain,
  };
}
export async function verifyPolicyRuns(db: Database, root: string) {
  let count = 0;
  for (const r of policyRuns(db).filter((r) => markedPolicy(db, r))) {
    policyIntent(r);
    ensure(
      r.status === "succeeded" && r.summary,
      "unfinished policy inspection requires review",
    );
    ensure(
      same(await policySummary(db, root, r), JSON.parse(r.summary)),
      "policy receipt missing/downgraded/mismatched",
    );
    count++;
  }
  return count;
}
