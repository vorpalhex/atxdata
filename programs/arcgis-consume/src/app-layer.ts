import type { Database } from "bun:sqlite";
import type { Archive } from "./archive";
import { ReadonlyAppEvidence } from "./app-readonly";
import { withReadOnlyArchive } from "./app-preopen";
import { ensure, object, array, integer, same } from "./check";
import {
  referenceOptions,
  validateReferenceOptions,
  referenceKind,
  type ReferenceOptions,
} from "./reference-contract";
import { referenceContext, retainedAsset } from "./app-reference";
import { derivedLayerURL, typedWebmapReferences } from "./reference-config";
import { policyRuns, rawCapture, hash } from "./policy-inspection-receipt";
import { layerSchema, featurePage, featureIds } from "./schema";
import { queryUrl } from "./sources";
import { terms } from "./rules";
import { profileAllowed } from "./profile-policy";
export const layerMode = "app-layer-v1";
export type AppLayerOptions = ReferenceOptions & {
  layerURL: string;
  pageSize: number;
  maxRecords: number;
  maxPages: number;
  fields?: string[];
  layerTermsSha256: string;
};
export function layerOptions(flags: Record<string, string>): AppLayerOptions {
  const rest = { ...flags };
  for (const k of [
    "--layer-url",
    "--page-size",
    "--max-records",
    "--max-pages",
    "--fields",
    "--layer-terms-sha256",
  ])
    delete rest[k];
  const base = referenceOptions(rest),
    n = (k: string, d: number) => {
      const s = flags[k];
      ensure(s === undefined || /^\d+$/.test(s), "invalid layer bound");
      return integer(
        s === undefined ? d : Number(s),
        1,
        Number.MAX_SAFE_INTEGER,
      );
    };
  return validateLayerOptions({
    ...base,
    layerURL: derivedLayerURL(flags["--layer-url"]),
    pageSize: n("--page-size", 1000),
    maxRecords: n("--max-records", 1000),
    maxPages: n("--max-pages", 100),
    ...(flags["--fields"] ? { fields: flags["--fields"].split(",") } : {}),
    layerTermsSha256: flags["--layer-terms-sha256"]!,
  });
}
function refOptions(o: AppLayerOptions) {
  const {
    layerURL,
    pageSize,
    maxRecords,
    maxPages,
    fields,
    layerTermsSha256,
    ...r
  } = o;
  return validateReferenceOptions(r);
}
function validateLayerOptions(value: AppLayerOptions) {
  refOptions(value);
  derivedLayerURL(value.layerURL);
  for (const k of ["pageSize", "maxRecords", "maxPages"] as const)
    integer(value[k], 1, Number.MAX_SAFE_INTEGER);
  ensure(
    /^[a-f0-9]{64}$/.test(value.layerTermsSha256 ?? ""),
    "explicit reviewed layer terms required",
  );
  if (value.fields)
    ensure(
      value.fields.length > 0 &&
        new Set(value.fields).size === value.fields.length &&
        value.fields.every((f) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(f)),
      "invalid fields",
    );
  return value;
}
async function binding(db: Database, root: string, o: AppLayerOptions) {
  const evidence = new ReadonlyAppEvidence(root, db),
    r = refOptions(o),
    p = await retainedAsset(db, root, r);
  ensure(
    p.role === "webmap-data",
    "layer requires actual derived WebMap data producer",
  );
  const d = typedWebmapReferences(p.raw, p.url, o.maxReferences),
    occurrences = d.references.filter(
      (r) => r.role === "layer" && r.publishedLayerURL === o.layerURL,
    );
  ensure(occurrences.length > 0, "layer URL absent from actual parent WebMap");
  evidence.assertCurrent();
  return {
    authority: "publisher-app-webmap",
    catalogMembershipClaim: false,
    wrapperRun: o.wrapperRun,
    wrapperSha256: o.wrapperSha256,
    parentRun: p.run,
    parentSha256: hash(p.raw),
    parentAttempt: p.capture.attempt,
    parentURL: p.url,
    layerURL: o.layerURL,
    occurrences,
  };
}
function saved(o: AppLayerOptions, b: object, run: string) {
  return {
    mode: layerMode,
    layerReceiptVersion: 1,
    wireKind: referenceKind,
    source: "austin",
    selection: o,
    binding: b,
    budget: o.budget,
    waiver: {
      kind: "operator-scoped-robots-omission-v1",
      acknowledged: true,
      resource: "https://maps.austintexas.gov/robots.txt",
      operation: layerMode,
      run,
    },
  };
}
const query = (u: string, p: Record<string, string>) =>
  queryUrl(u + "/query", { where: "1=1", ...p });
async function readRaw(
  a: { root: string; store: { db: Database } },
  run: string,
  label: string,
  url: string,
  o: AppLayerOptions,
) {
  const h = await rawCapture(
    a.store.db,
    a.root,
    run,
    label,
    url,
    referenceKind,
    Math.min(o.budget.responseBytes, o.budget.zipBytes, o.budget.totalBytes),
  );
  ensure(h.receipt.status === 200, "layer response not200");
  return object(JSON.parse(h.raw.toString()));
}
function nativeMetadata(v: unknown) {
  const raw = object(v);
  if (typeof raw.objectIdField === "string") return raw;
  const oid = array(raw.fields)
    .map(object)
    .filter((f) => f.type === "esriFieldTypeOID");
  ensure(
    oid.length === 1 && typeof oid[0]!.name === "string",
    "native unique OID definition required",
  );
  return { ...raw, objectIdField: oid[0]!.name };
}
function plan(v: unknown, o: AppLayerOptions) {
  const m = nativeMetadata(v),
    fields =
      o.fields ??
      array(m.fields)
        .map(object)
        .filter((f) => f.type !== "esriFieldTypeGeometry")
        .map((f) => String(f.name)),
    p = layerSchema(m, fields),
    cap = object(m.advancedQueryCapabilities);
  ensure(
    cap.supportsPagination === true && cap.supportsOrderBy === true,
    "unsupported ordered pagination",
  );
  ensure(
    terms(m).sha256 === o.layerTermsSha256,
    "layer terms changed/unapproved",
  );
  return { ...p, size: Math.min(p.max, o.pageSize) };
}
async function expectedURL(
  a: { root: string; store: { db: Database } },
  run: string,
  label: string,
  o: AppLayerOptions,
) {
  if (label === "layer-before" || label === "layer-after")
    return queryUrl(o.layerURL, {});
  if (label === "count-before" || label === "count-after")
    return query(o.layerURL, { returnCountOnly: "true" });
  if (label === "ids-before" || label === "ids-after")
    return query(o.layerURL, {
      returnIdsOnly: "true",
      returnGeometry: "false",
    });
  ensure(/^page-\d+$/.test(label), "unknown layer request role");
  const metadata = await readRaw(
      a,
      run,
      "layer-before",
      queryUrl(o.layerURL, {}),
      o,
    ),
    p = plan(metadata, o),
    count = integer(
      (
        await readRaw(
          a,
          run,
          "count-before",
          query(o.layerURL, { returnCountOnly: "true" }),
          o,
        )
      ).count,
      0,
      o.maxRecords,
    ),
    off = Number(label.slice(5)),
    size = Math.min(p.size, count - off);
  ensure(
    off >= 0 && off < count && off % p.size === 0 && off / p.size < o.maxPages,
    "page selection/bound mismatch",
  );
  return query(o.layerURL, {
    outFields: p.fields.join(","),
    returnGeometry: "true",
    orderByFields: p.oid + " ASC",
    resultOffset: String(off),
    resultRecordCount: String(size),
  });
}
export async function verifyRawLayerSource(
  a: Archive,
  run: string,
  label: string,
  url: string,
  kind: string,
) {
  const s = a.store.options(run)!;
  ensure(
    s.mode === layerMode &&
      s.layerReceiptVersion === 1 &&
      s.wireKind === referenceKind,
    "layer intent missing",
  );
  const o = validateLayerOptions(s.selection as AppLayerOptions),
    b = await binding(a.store.db, a.root, o);
  ensure(same(s, saved(o, b, run)), "raw layer parent/source substitution");
  const origin = new URL(o.layerURL).origin;
  ensure(
    (kind === referenceKind && url === (await expectedURL(a, run, label, o))) ||
      (kind === "text" &&
        label === "layer-robots" &&
        origin !== "https://maps.austintexas.gov" &&
        url === origin + "/robots.txt"),
    "raw layer URL/role substitution",
  );
  a.store.preflight();
}
async function summary(
  a: { root: string; store: { db: Database } },
  run: string,
  o: AppLayerOptions,
  b: object,
) {
  const metadata = await readRaw(
      a,
      run,
      "layer-before",
      queryUrl(o.layerURL, {}),
      o,
    ),
    p = plan(metadata, o),
    count = integer(
      (
        await readRaw(
          a,
          run,
          "count-before",
          query(o.layerURL, { returnCountOnly: "true" }),
          o,
        )
      ).count,
      0,
      o.maxRecords,
    ),
    ids = featureIds(
      await readRaw(
        a,
        run,
        "ids-before",
        query(o.layerURL, { returnIdsOnly: "true", returnGeometry: "false" }),
        o,
      ),
      count,
      p.oid,
    ),
    actual: number[] = [];
  for (let off = 0; off < count; off += p.size) {
    ensure(off / p.size < o.maxPages, "whole-layer page budget exhausted");
    const page = await readRaw(
      a,
      run,
      `page-${off}`,
      await expectedURL(a, run, `page-${off}`, o),
      o,
    );
    ensure(
      !page.exceededTransferLimit || off + p.size < count,
      "truncated page",
    );
    const got = featurePage(
      page,
      nativeMetadata(metadata),
      p.fields,
      Math.min(p.size, count - off),
    );
    ensure(
      same(got, ids.slice(off, off + p.size)),
      "missing/duplicate/changed feature IDs",
    );
    actual.push(...got);
  }
  ensure(
    actual.length === count && new Set(actual).size === count,
    "incomplete/duplicate complete layer",
  );
  ensure(
    (
      await readRaw(
        a,
        run,
        "count-after",
        query(o.layerURL, { returnCountOnly: "true" }),
        o,
      )
    ).count === count,
    "layer count changed",
  );
  ensure(
    same(
      ids,
      featureIds(
        await readRaw(
          a,
          run,
          "ids-after",
          query(o.layerURL, { returnIdsOnly: "true", returnGeometry: "false" }),
          o,
        ),
        count,
        p.oid,
      ),
    ),
    "layer IDs changed",
  );
  ensure(
    same(
      metadata,
      await readRaw(a, run, "layer-after", queryUrl(o.layerURL, {}), o),
    ),
    "native schema/version changed",
  );
  return {
    mode: layerMode,
    layerReceiptVersion: 1,
    binding: b,
    acquiredFeatures: true,
    records: count,
    service: o.layerURL,
    fields: p.fields,
    nativeSchema: metadata,
    spatialReference: p.sr,
    objectIdField: p.oid,
    objectIdDerivation:
      typeof metadata.objectIdField === "string"
        ? "published objectIdField"
        : "unique published esriFieldTypeOID definition",
    identitySha256: hash(JSON.stringify(ids)),
    deduplicated: true,
    catalogMembershipClaim: false,
    scope:
      "whole explicitly selected bounded native XY layer; not historical/transactional completeness",
  };
}
async function strictLayerPolicy(
  a: Pick<Archive, "request" | "readExpected"> &
    Partial<Pick<Archive, "setSpacing">>,
  run: string,
  o: AppLayerOptions,
  offline: boolean,
) {
  const origin = new URL(o.layerURL).origin;
  if (origin === "https://maps.austintexas.gov") return;
  const url = origin + "/robots.txt",
    text = String(
      offline
        ? await a.readExpected(run, "layer-robots", url, "text")
        : await a.request(run, "layer-robots", url, "text"),
    );
  a.setSpacing?.(profileAllowed("water", url, text, o.layerURL));
}
export async function verifyLayerRuns(db: Database, root: string) {
  let count = 0;
  const e = new ReadonlyAppEvidence(root, db);
  for (const r of policyRuns(db)) {
    const s = r.options ? object(JSON.parse(r.options)) : {};
    if (r.command !== "collect-app-layer" && s.mode !== layerMode) continue;
    ensure(
      r.status === "succeeded" && r.summary,
      "unfinished app layer requires review",
    );
    const o = validateLayerOptions(s.selection as AppLayerOptions),
      b = await binding(db, root, o);
    ensure(same(s, saved(o, b, r.id)), "app layer intent changed");
    await strictLayerPolicy(e, r.id, o, true);
    ensure(
      same(await summary(e, r.id, o, b), JSON.parse(r.summary)),
      "layer receipt mismatch",
    );
    count++;
  }
  e.assertCurrent();
  return count;
}
export async function readOnlyLayerPreflight(
  root: string,
  o?: AppLayerOptions,
) {
  await withReadOnlyArchive(
    root,
    async (db) => {
      await verifyLayerRuns(db, root);
      if (o) await binding(db, root, validateLayerOptions(o));
    },
    Boolean(o),
  );
}
export async function collectAppLayer(a: Archive, value: AppLayerOptions) {
  const o = validateLayerOptions(value);
  a.store.preflight();
  const b = await binding(a.store.db, a.root, o),
    key =
      "austin:" +
      layerMode +
      ":" +
      hash(JSON.stringify({ url: o.layerURL, fields: o.fields ?? null })),
    prior = policyRuns(a.store.db).find(
      (r) => r.source === key && r.command === "collect-app-layer",
    );
  if (prior) {
    ensure(
      same(JSON.parse(prior.options!), saved(o, b, prior.id)),
      "immutable app-layer source/options changed",
    );
    const result = await summary(a, prior.id, o, b);
    return { run: prior.id, reused: true, summary: result };
  }
  a.store.source(key, "Publisher-bound native app layer", o.layerURL);
  const run = a.store.start(key, "collect-app-layer");
  a.store.saveOptions(run, saved(o, b, run));
  const old = a.guard;
  a.guard = (u) =>
    ensure(
      u.startsWith(o.layerURL + "?") ||
        u.startsWith(o.layerURL + "/query?") ||
        u === new URL(o.layerURL).origin + "/robots.txt",
      "layer guard refused",
    );
  a.setSpacing(3000);
  const get = async (label: string) => {
    const u = await expectedURL(a, run, label, o);
    await a.request(run, label, u, referenceKind);
    return readRaw(a, run, label, u, o);
  };
  try {
    await strictLayerPolicy(a, run, o, false);
    const m = await get("layer-before"),
      p = plan(m, o),
      count = integer((await get("count-before")).count, 0, o.maxRecords);
    featureIds(await get("ids-before"), count, p.oid);
    for (let off = 0; off < count; off += p.size) {
      ensure(off / p.size < o.maxPages, "whole-layer page ceiling");
      await get("page-" + off);
    }
    await get("count-after");
    await get("ids-after");
    await get("layer-after");
    const result = await summary(a, run, o, b);
    a.store.finish(run, "succeeded", undefined, result);
    return { run, reused: false, summary: result };
  } catch (e) {
    a.store.finish(
      run,
      "failed",
      e instanceof Error ? e.message : "layer failure",
    );
    throw e;
  } finally {
    a.guard = old;
  }
}
