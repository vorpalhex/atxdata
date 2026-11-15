import { sameAcquisition } from "./acquisition-compat";
import { terms } from "./rules";
import type { Database } from "bun:sqlite";
import type { Archive } from "./archive";
import { ensure, object } from "./check";
import { ReadonlyAppEvidence } from "./app-readonly";
import { withReadOnlyArchive } from "./app-preopen";
import { retainedWrapper, verifyWrapperRuns } from "./wrapper";
import { policyRuns, rawCapture, hash } from "./policy-inspection-receipt";
import {
  referenceMode,
  referenceKind,
  validateReferenceOptions,
  type ReferenceOptions,
} from "./reference-contract";
import { deriveReferences } from "./reference-derivation";
import {
  referenceEntry,
  protocolConfig,
  portalConfigReferences,
  itemDataReference,
  typedAppReferences,
  typedWebmapReferences,
  type DerivedReference,
} from "./reference-config";
export type Asset = {
  run: string;
  raw: Buffer;
  url: string;
  role: string;
  documentURL: string;
  capture: any;
  rootBinding: any;
  expected?: DerivedReference;
};
function runRow(db: Database, id: string) {
  const r = policyRuns(db).find((r) => r.id === id);
  ensure(r && r.options, "missing parent run");
  return r;
}
function key(o: ReferenceOptions, url: string) {
  return `austin:${referenceMode}:${hash(JSON.stringify({ wrapper: o.wrapperRun, parent: o.parentRun, url, helper: o.helperRun ?? null }))}`;
}
function save(o: ReferenceOptions, binding: unknown, run: string) {
  return {
    mode: referenceMode,
    resolutionReceiptVersion: 1,
    wireKind: referenceKind,
    source: "austin",
    selection: o,
    binding,
    budget: o.budget,
  };
}
export async function retainedAsset(
  db: Database,
  root: string,
  o: ReferenceOptions,
  id = o.parentRun,
  seen = new Set<string>(),
): Promise<Asset> {
  ensure(!seen.has(id) && seen.size < 16, "reference ancestry cycle/depth");
  const next = new Set(seen).add(id);
  if (id === o.wrapperRun) {
    const w = await retainedWrapper(db, root, id, o.wrapperSha256);
    return {
      run: id,
      raw: w.raw,
      url: w.publishedURL,
      role: "frame",
      documentURL: w.publishedURL,
      capture: w.capture,
      rootBinding: w.binding,
    };
  }
  const r = runRow(db, id),
    s = object(JSON.parse(r.options!));
  ensure(
    r.status === "succeeded" && r.summary && s.mode === referenceMode,
    "complete reference parent required",
  );
  const own = validateReferenceOptions(s.selection);
  ensure(
    own.wrapperRun === o.wrapperRun && own.wrapperSha256 === o.wrapperSha256,
    "parent belongs to another wrapper",
  );
  const c = await referenceContext(db, root, own, next);
  ensure(
    c.selected && sameAcquisition(s, save(own, c.binding, r.id)),
    "reference parent intent/source mismatch",
  );
  const h = await rawCapture(
    db,
    root,
    r.id,
    "reference-body",
    c.selected.url!,
    referenceKind,
    Math.min(
      own.budget.responseBytes,
      own.budget.zipBytes,
      own.budget.totalBytes,
    ),
  );
  ensure(
    h.receipt.status === 200 &&
      !h.headers.has("www-authenticate") &&
      !h.headers.has("proxy-authenticate"),
    "parent not complete public HTTP200",
  );
  const actual = await receiptSummary(db, root, r.id, own, c, h);
  ensure(
    sameAcquisition(actual, JSON.parse(r.summary!)),
    "reference receipt changed/downgraded",
  );
  return {
    run: r.id,
    raw: h.raw,
    url: c.selected.url!,
    role: c.selected.role,
    documentURL:
      c.selected.documentURL ??
      (c.selected.role === "frame" ? c.selected.url! : c.parent.documentURL),
    capture: h.receipt,
    rootBinding: c.parent.rootBinding,
    expected: c.selected,
  };
}
async function derived(
  db: Database,
  root: string,
  o: ReferenceOptions,
  p: Asset,
  seen: Set<string>,
) {
  if (p.role === "frame")
    return deriveReferences(p.raw, p.url, o.maxReferences);
  if (p.role === "script") {
    if (!p.raw.toString().includes("_detectPortals()"))
      return {
        references: [],
        unresolved: true,
        reason: "script has no supported config protocol",
      };
    if (!o.helperRun)
      return {
        references: [],
        unresolved: true,
        reason: "native published fetch-helper producer required",
      };
    const helper = await retainedAsset(db, root, o, o.helperRun, seen);
    ensure(
      helper.role === "script" && helper.documentURL === p.documentURL,
      "helper is not a script of the same document",
    );
    const proof = protocolConfig(p.raw, p.documentURL, helper.raw);
    return {
      references: [
        referenceEntry(
          hash(p.raw),
          p.documentURL,
          0,
          "portal-config",
          proof.literal,
          proof.url,
          { documentURL: p.documentURL, item: proof.item },
        ),
      ],
      protocolProof: proof,
    };
  }
  if (p.role === "layer") {
    const nativeSchema = object(JSON.parse(p.raw.toString()));
    ensure(!nativeSchema.error, "layer metadata response error");
    return {
      references: [],
      metadataOnly: true,
      acquiredFeatures: false,
      publishedLayerURL: p.expected!.publishedLayerURL,
      nativeSchema,
      layerTermsSha256: terms(nativeSchema).sha256,
    };
  }
  if (p.role === "portal-config")
    return { references: portalConfigReferences(p.raw, p.url, p.documentURL) };
  if (p.role === "portal-app-item" || p.role === "webmap-item")
    return { references: [itemDataReference(p.raw, p.url, p.expected!)] };
  if (p.role === "portal-app-data")
    return typedAppReferences(p.raw, p.url, o.maxReferences);
  if (p.role === "webmap-data")
    return typedWebmapReferences(p.raw, p.url, o.maxReferences);
  return {
    references: [],
    unresolved: true,
    reason: "unsupported source role",
  };
}
export async function referenceContext(
  db: Database,
  root: string,
  value: ReferenceOptions,
  seen = new Set<string>(),
) {
  const o = validateReferenceOptions(value),
    e = new ReadonlyAppEvidence(root, db);
  const parent = await retainedAsset(db, root, o, o.parentRun, seen);
  const d = await derived(db, root, o, parent, seen);
  const refs = d.references as DerivedReference[];
  const selected = o.referenceSha256
    ? refs.find((r) => r.sha256 === o.referenceSha256)
    : undefined;
  if (o.referenceSha256) {
    ensure(
      selected && selected.url && selected.role !== "blocked",
      "reference not present/admitted in actual parent",
    );
    ensure(
      !selected.requiredTermsSha256 ||
        selected.requiredTermsSha256 === o.dependencyTermsSha256,
      "review dependency metadata terms before data",
    );
  }
  const binding = {
    wrapperRun: o.wrapperRun,
    wrapperSha256: o.wrapperSha256,
    rootBinding: parent.rootBinding,
    parent: {
      run: parent.run,
      url: parent.url,
      sha256: hash(parent.raw),
      attempt: parent.capture.attempt,
    },
    ...(selected ? { selected } : {}),
    ...("protocolProof" in d ? { protocolProof: d.protocolProof } : {}),
  };
  e.assertCurrent();
  return { parent, derived: d, selected, binding };
}
async function receiptSummary(
  db: Database,
  root: string,
  run: string,
  o: ReferenceOptions,
  c: Awaited<ReturnType<typeof referenceContext>>,
  h: Awaited<ReturnType<typeof rawCapture>>,
) {
  ensure(h.receipt.status === 200, "reference HTTP status not200; unresolved");
  const dbRows = db
    .query<{ bytes: number }, [string]>(
      "SELECT bytes FROM attempts WHERE run=?",
    )
    .all(run);
  ensure(
    dbRows.length <= o.budget.requests &&
      dbRows.reduce((n, r) => n + r.bytes, 0) <= o.budget.totalBytes,
    "all-child operation budget exceeded",
  );
  return {
    mode: referenceMode,
    resolutionReceiptVersion: 1,
    derivationVersion: 2,
    binding: c.binding,
    capture: h.receipt,
    catalogMembershipClaim: false,
    metadataOnly: true,
    acquiredFeatures: false,
    acquiredFiles: false,
    wrapperResolved: false,
    scope:
      "one explicit publisher-derived reference; underlying layers require separate native selection",
  };
}
export async function verifyReferenceRuns(db: Database, root: string) {
  let n = 0;
  for (const r of policyRuns(db)) {
    const s = r.options ? object(JSON.parse(r.options)) : {};
    if (r.command !== "resolve-app" && s.mode !== referenceMode) continue;
    ensure(
      r.status === "succeeded" && r.summary,
      "unfinished reference requires review",
    );
    const o = validateReferenceOptions(s.selection);
    await retainedAsset(db, root, o, r.id);
    const a = new ReadonlyAppEvidence(root, db);
    a.assertCurrent();
    n++;
  }
  return n;
}
export async function readOnlyReferencePreflight(
  root: string,
  o?: ReferenceOptions,
) {
  let context: any;
  await withReadOnlyArchive(
    root,
    async (db) => {
      await verifyWrapperRuns(db, root);
      await verifyReferenceRuns(db, root);
      if (o) context = await referenceContext(db, root, o);
    },
    Boolean(o),
  );
  return context;
}
export async function verifyRawReferenceSource(
  a: Archive,
  run: string,
  label: string,
  url: string,
  kind: string,
) {
  const s = a.store.options(run)!;
  ensure(
    s.mode === referenceMode &&
      s.resolutionReceiptVersion === 1 &&
      s.wireKind === referenceKind,
    "unknown derived raw intent",
  );
  const o = validateReferenceOptions(s.selection),
    c = await referenceContext(a.store.db, a.root, o);
  ensure(
    c.selected && sameAcquisition(s, save(o, c.binding, run)),
    "raw derived producer binding mismatch",
  );
  const target = c.selected.url!;
  ensure(
    kind === referenceKind && label === "reference-body" && url === target,
    "raw derived URL/role substitution",
  );
  a.store.preflight();
}
export async function resolveApp(a: Archive, value: ReferenceOptions) {
  const o = validateReferenceOptions(value);
  a.store.preflight();
  const c = await referenceContext(a.store.db, a.root, o);
  if (!c.selected)
    return {
      mode: "reference-context-v2",
      binding: c.binding,
      ...c.derived,
      httpRequests: 0,
    };
  const k = key(o, c.selected.url!),
    prior = policyRuns(a.store.db).find(
      (r) => r.source === k && r.command === "resolve-app",
    );
  if (prior) {
    ensure(
      sameAcquisition(JSON.parse(prior.options!), save(o, c.binding, prior.id)),
      "immutable reference selection/budget changed",
    );
    await retainedAsset(a.store.db, a.root, o, prior.id);
    return { run: prior.id, reused: true, summary: JSON.parse(prior.summary!) };
  }
  a.store.preflight();
  a.store.source(k, "Publisher-derived application reference", c.selected.url!);
  const run = a.store.start(k, "resolve-app");
  a.store.saveOptions(run, save(o, c.binding, run));
  const guard = a.guard;
  a.guard = (url) => ensure(url === c.selected!.url, "reference guard refused");
  a.setSpacing(3000);
  try {
    await a.request(run, "reference-body", c.selected.url!, referenceKind);
    const h = await rawCapture(
      a.store.db,
      a.root,
      run,
      "reference-body",
      c.selected.url!,
      referenceKind,
      Math.min(o.budget.responseBytes, o.budget.zipBytes, o.budget.totalBytes),
    );
    const summary = await receiptSummary(a.store.db, a.root, run, o, c, h);
    a.store.finish(run, "succeeded", undefined, summary);
    return { run, reused: false, summary };
  } catch (e) {
    a.store.finish(
      run,
      "failed",
      e instanceof Error ? e.message : "reference failure",
    );
    throw e;
  } finally {
    a.guard = guard;
  }
}
