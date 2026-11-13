import type { Database } from "bun:sqlite";
import type { Archive } from "./archive";
import { ReadonlyAppEvidence } from "./app-readonly";
import { withReadOnlyArchive } from "./app-preopen";
import { verifyAppRuns } from "./app-metadata";
import { ensure, object, same } from "./check";
import {
  policyRuns,
  sourceBinding,
  verifyPolicyRuns,
  rawCapture,
  classify,
  hash,
  type Run,
} from "./policy-inspection-receipt";
import {
  wrapperMode,
  wrapperKind,
  validateWrapperOptions,
  waiver,
  type WrapperOptions,
} from "./wrapper-contract";
function marked(db: Database, r: Run) {
  const s = r.options ? object(JSON.parse(r.options)) : {};
  const summary = r.summary ? object(JSON.parse(r.summary)) : {};
  return (
    r.command === "inspect-wrapper" ||
    r.source.includes(":app-wrapper-") ||
    String(s.mode ?? "").startsWith("app-wrapper-") ||
    Object.hasOwn(s, "wrapperReceiptVersion") ||
    Object.hasOwn(summary, "wrapperReceiptVersion") ||
    Boolean(
      db
        .query(
          "SELECT 1 FROM observations WHERE run=? AND (kind=? OR label='wrapper-html') LIMIT 1",
        )
        .get(r.id, wrapperKind),
    )
  );
}
function saved(options: WrapperOptions, binding: object, run: string) {
  return {
    mode: wrapperMode,
    wrapperReceiptVersion: 1,
    wireKind: wrapperKind,
    source: "austin",
    selection: options,
    binding,
    waiver: waiver(binding, run),
    budget: options.budget,
  };
}
async function binding(db: Database, root: string, options: WrapperOptions) {
  const { acknowledgeMapsRobotsOmission, ...selection } = options;
  return sourceBinding(db, root, selection, true);
}
async function references(raw: Buffer, publishedURL: string) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const refs: {
    tag: string;
    attribute: string;
    literal?: string;
    literalSha256: string;
    acquired: false;
  }[] = [];
  const collect = (tag: string, attribute: string) => ({
    element(el: HTMLRewriterTypes.Element) {
      const literal = el.getAttribute(attribute)!;
      // Private/query-bearing or cross-origin values remain in the original body,
      // not in CLI output. No reference is interpreted as acquisition permission.
      let safe = false;
      try {
        const u = new URL(literal, publishedURL);
        safe =
          u.origin === new URL(publishedURL).origin &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          !/[\\\u0000-\u0020\u007f]/.test(literal);
      } catch {}
      ensure(refs.length < 4096, "wrapper reference ceiling exceeded");
      refs.push({
        tag,
        attribute,
        ...(safe ? { literal } : {}),
        literalSha256: hash(literal),
        acquired: false,
      });
    },
  });
  await new HTMLRewriter()
    .on("script[src]", collect("script", "src"))
    .on("link[href]", collect("link", "href"))
    .on("base[href]", collect("base", "href"))
    .transform(new Response(text))
    .arrayBuffer();
  return refs;
}
async function summary(db: Database, root: string, r: Run) {
  const s = object(JSON.parse(r.options ?? "null")),
    options = validateWrapperOptions(s.selection),
    b = await binding(db, root, options);
  ensure(
    r.command === "inspect-wrapper" &&
      r.source === `austin:${options.item}:${wrapperMode}` &&
      same(s, saved(options, b, r.id)),
    "wrapper intent/waiver/source binding missing or changed",
  );
  const h = await rawCapture(
    db,
    root,
    r.id,
    "wrapper-html",
    String(b.publishedURL),
    wrapperKind,
    Math.min(
      options.budget.responseBytes,
      options.budget.zipBytes,
      options.budget.totalBytes,
    ),
  );
  ensure(
    h.receipt.status === 200 &&
      classify(h, 0) === "html-not-policy" &&
      /^text\/html(?:;|$)/i.test(h.headers.get("content-type") ?? ""),
    "wrapper response is not admitted HTML",
  );
  ensure(
    db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) n FROM attempts WHERE run=?",
      )
      .get(r.id)!.n === 1 &&
      db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) n FROM observations WHERE run=?",
        )
        .get(r.id)!.n === 1,
    "wrapper request/observation budget mismatch",
  );
  return {
    mode: wrapperMode,
    wrapperReceiptVersion: 1,
    wireKind: wrapperKind,
    binding: b,
    waiver: waiver(b, r.id),
    wrapperHtmlCaptured: true,
    wrapperResolved: false,
    bootstrapAcquired: false,
    acquiredFeatures: false,
    acquiredFiles: false,
    semanticServiceEquivalence: false,
    permission: false,
    navigation: false,
    scope: "literal wrapper HTML only; no reference-following permission",
    capture: h.receipt,
    references: await references(h.raw, String(b.publishedURL)),
  };
}
async function verifyReceipts(db: Database, root: string) {
  let count = 0;
  for (const r of policyRuns(db).filter((r) => marked(db, r))) {
    ensure(
      r.status === "succeeded" && r.summary,
      "unfinished wrapper operation requires review",
    );
    ensure(
      same(await summary(db, root, r), JSON.parse(r.summary)),
      "wrapper receipt missing/downgraded/mismatched",
    );
    count++;
  }
  return count;
}
async function closure(root: string, db: Database, options?: WrapperOptions) {
  const evidence = new ReadonlyAppEvidence(root, db);
  await verifyAppRuns(evidence);
  await verifyPolicyRuns(db, root);
  const count = await verifyReceipts(db, root);
  const selected = options
    ? await binding(db, root, validateWrapperOptions(options))
    : undefined;
  if (options) {
    const prior = policyRuns(db).find(
      (r) =>
        r.source === `austin:${options.item}:${wrapperMode}` &&
        r.command === "inspect-wrapper",
    );
    if (prior)
      ensure(
        same(JSON.parse(prior.options!), saved(options, selected!, prior.id)),
        "wrapper immutable selection/waiver/budget changed",
      );
  }
  evidence.assertCurrent();
  return { evidence, binding: selected, count };
}
export async function verifyWrapperRuns(db: Database, root: string) {
  if (!policyRuns(db).some((r) => marked(db, r))) return 0;
  return (await closure(root, db)).count;
}
export async function readOnlyWrapperPreflight(
  root: string,
  options?: WrapperOptions,
) {
  if (options) validateWrapperOptions(options);
  await withReadOnlyArchive(
    root,
    async (db) => {
      if (options || policyRuns(db).some((r) => marked(db, r)))
        await closure(root, db, options);
    },
    Boolean(options),
  );
}
/** Raw callers may construct a new intent, but cannot replace its retained source.
 * The current raw run is intentionally in progress: verify prerequisite closure,
 * not a yet-to-be-produced wrapper receipt. No writer, recovery or transport here.
 */
export async function verifyRawWrapperSource(a: Archive, run: string) {
  const evidence = new ReadonlyAppEvidence(a.root, a.store.db);
  const saved = a.store.options(run)!;
  const options = validateWrapperOptions(saved.selection);
  await verifyAppRuns(evidence);
  await verifyPolicyRuns(a.store.db, a.root);
  const actual = await binding(a.store.db, a.root, options);
  ensure(
    same(saved.binding, actual),
    "raw wrapper retained source binding mismatch",
  );
  evidence.assertCurrent();
  a.store.preflight();
}
export async function inspectWrapper(a: Archive, value: WrapperOptions) {
  const options = validateWrapperOptions(value);
  a.store.preflight();
  const c = await closure(a.root, a.store.db, options),
    b = c.binding!;
  const key = `austin:${options.item}:${wrapperMode}`;
  const prior = policyRuns(a.store.db).find(
    (r) => r.source === key && r.command === "inspect-wrapper",
  );
  if (prior) {
    ensure(
      same(JSON.parse(prior.options!), saved(options, b, prior.id)),
      "wrapper immutable selection/waiver/budget changed",
    );
    const result = await summary(a.store.db, a.root, prior);
    c.evidence.assertCurrent();
    a.store.preflight();
    return { run: prior.id, reused: true, summary: result };
  }
  c.evidence.assertCurrent();
  a.store.preflight();
  a.store.source(
    key,
    "Austin literal application wrapper",
    String(b.publishedURL),
  );
  const run = a.store.start(key, "inspect-wrapper");
  a.store.saveOptions(run, saved(options, b, run));
  a.setSpacing(3000);
  const oldGuard = a.guard;
  a.guard = (url) =>
    ensure(url === b.publishedURL, "wrapper literal source URL refused");
  try {
    await a.request(run, "wrapper-html", String(b.publishedURL), wrapperKind);
    const r = policyRuns(a.store.db).find((r) => r.id === run)!;
    const result = await summary(a.store.db, a.root, r);
    a.store.finish(run, "succeeded", undefined, result);
    return { run, reused: false, summary: result };
  } catch (error) {
    a.store.finish(
      run,
      "failed",
      error instanceof Error ? error.message : "wrapper capture failed",
    );
    throw error;
  } finally {
    a.guard = oldGuard;
  }
}
