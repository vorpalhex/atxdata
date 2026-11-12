import { acquirePublished, verifyPublished } from "./published";
import { waterCatalog } from "./water";
import {
  unavailablePolicy,
  sourcePolicy,
  profileAllowed,
  verifyProfilePolicy,
} from "./profile-policy";
import { Archive } from "./archive";
import { array, ensure, integer, object, same } from "./check";
import {
  configs,
  catalogQuery,
  itemUrl,
  queryUrl,
  sharing,
  validateItem,
  stableItem,
  source as validateSource,
  type Source,
} from "./sources";
import {
  validateCatalogPage,
  serviceUrl,
  serviceRoute,
  sourceService,
  catalogEntry,
} from "./catalog";
import { allowed, terms } from "./rules";
import { layerSchema, featurePage, featureIds } from "./schema";
import { validateBudget } from "./policy";

export type Selection = {
  item: string;
  layer?: number;
  service?: string;
  fields?: string[];
  pageSize: number;
  maxRecords: number;
  maxPages: number;
  expandedBytes: number;
  maxMembers: number;
  budget: {
    requests: number;
    totalBytes: number;
    responseBytes: number;
    zipBytes: number;
    retries: number;
  };
};
export function validateSelection(value: unknown): asserts value is Selection {
  const s = object(value);
  ensure(
    typeof s.item === "string" && /^[a-f0-9]{32}$/.test(s.item),
    "malformed item ID",
  );
  if (s.layer !== undefined) integer(s.layer, 0, Number.MAX_SAFE_INTEGER);
  if (s.service !== undefined) serviceUrl(s.service);
  for (const key of [
    "pageSize",
    "maxRecords",
    "maxPages",
    "expandedBytes",
    "maxMembers",
  ])
    integer(s[key], 1, Number.MAX_SAFE_INTEGER);
  if (s.fields !== undefined) {
    const fields = array(s.fields);
    ensure(
      fields.length > 0 &&
        fields.every(
          (f) => typeof f === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(f),
        ) &&
        new Set(fields).size === fields.length,
      "invalid fields",
    );
  }
  validateBudget(s.budget, true);
}
export function selectionOptions(
  flags: Record<string, string>,
): Selection | undefined {
  if (!flags["--item"]) {
    ensure(
      !Object.keys(flags).some(
        (k) =>
          !["--source", "--archive", "--resume", "--terms-sha256"].includes(k),
      ),
      "selection budgets require --item",
    );
    return;
  }
  const item = flags["--item"];
  ensure(/^[a-f0-9]{32}$/.test(item), "malformed item ID");
  const n = (key: string, fallback: number, min = 1) => {
    const text = flags[key];
    ensure(
      text === undefined || /^\d+$/.test(text),
      "invalid numeric option " + key,
    );
    return integer(
      text === undefined ? fallback : Number(text),
      min,
      Number.MAX_SAFE_INTEGER,
    );
  };
  const fields = flags["--fields"]?.split(",");
  if (fields)
    ensure(
      fields.every((f) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(f)) &&
        new Set(fields).size === fields.length,
      "invalid fields",
    );
  return {
    item,
    layer: flags["--layer"] === undefined ? undefined : n("--layer", 0, 0),
    service:
      flags["--service"] === undefined
        ? undefined
        : serviceUrl(flags["--service"]),
    fields,
    pageSize: n("--page-size", 1000),
    maxRecords: n("--max-records", 1_000_000),
    maxPages: n("--max-pages", 1000),
    expandedBytes: n("--expanded-bytes", 512 * 1024 * 1024),
    maxMembers: n("--max-members", 1000),
    budget: {
      requests: n("--max-requests", 1000),
      totalBytes: n("--max-bytes", 256 * 1024 * 1024),
      responseBytes: n("--response-bytes", 16 * 1024 * 1024),
      zipBytes: n("--raw-bytes", 128 * 1024 * 1024),
      retries: 0,
    },
  };
}
export async function readCatalog(
  a: Archive,
  run: string,
  source: Source,
  maxPages: number,
  offline = false,
) {
  const request: Archive["request"] = async (
    r,
    label,
    url,
    kind,
    validate = () => {},
  ) => {
    if (!offline) return a.request(r, label, url, kind, validate);
    const value = await a.readExpected(r, label, url, kind);
    await validate(value);
    return value;
  };
  const config = configs[source];
  await request(run, "site-item", itemUrl(config.site), "json", (v) =>
    validateItem(v, config.site),
  );
  const data = await request(
    run,
    "site-data",
    itemUrl(config.site, true),
    "json",
  );
  if (source === "water") {
    ensure(
      object(await a.read(run, "site-item")).type === "Dashboard",
      "Water root is not a dashboard",
    );
    return waterCatalog(request, run, data, maxPages);
  }
  const q = catalogQuery(source, data, true),
    seen = new Set<string>(),
    items: unknown[] = [];
  let start = 1,
    total: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const raw = await request(
      run,
      page === 0 ? "catalog" : `catalog-${start}`,
      queryUrl(sharing + "/search", {
        q,
        num: "100",
        start: String(start),
        sortField: "id",
        sortOrder: "asc",
      }),
      "json",
    );
    const parsed = validateCatalogPage(raw, start, seen, total);
    items.push(...parsed.results);
    total = parsed.total;
    if (parsed.next === -1)
      return {
        items,
        query: q,
        catalogItems: items.length,
        source,
        scope:
          "complete bounded catalog metadata; not authorization for personal data acquisition",
      };
    start = parsed.next;
  }
  throw new Error(
    "catalog page budget exhausted; resume same run with unchanged budget or start an explicitly larger operation; not complete",
  );
}
function httpStatus(error: unknown, status: number) {
  return error instanceof Error && "status" in error && error.status === status;
}
async function robotsPolicy(a: Archive, run: string, origin: string) {
  const policyUrl = origin + "/robots.txt";
  if (unavailablePolicy(a, run, policyUrl)) return undefined;
  try {
    return String(
      await a.request(
        run,
        "robots-" + new URL(origin).hostname,
        policyUrl,
        "text",
      ),
    );
  } catch (e) {
    if (httpStatus(e, 403) && unavailablePolicy(a, run, policyUrl))
      return undefined;
    if (httpStatus(e, 404)) return "";
    throw e;
  }
}
export async function gate(
  a: Archive,
  run: string,
  origins = ["https://www.arcgis.com", "https://gis.traviscountytx.gov"],
) {
  a.guard = undefined;
  a.setSpacing(3000);
  const source = a.store.options(run)?.source;
  const rules: Record<string, string | undefined> = {};
  for (const origin of origins) {
    const text = await robotsPolicy(a, run, origin);
    rules[origin] = text;
    if (text !== undefined)
      a.setSpacing(
        allowed(origin + "/robots.txt", text, origin + "/robots.txt"),
      );
  }
  a.guard = (url) => {
    const origin = new URL(url).origin;
    ensure(origin in rules, "authority missing robots gate");
    const text = rules[origin];
    if (text !== undefined)
      a.setSpacing(profileAllowed(source, origin + "/robots.txt", text, url));
  };
}
function validateInvocation(
  source: Source,
  command: string,
  options: Selection & { termsSha256?: string; resume?: string },
) {
  validateSelection(options);
  validateSource(source);
  if (options.service) sourceService(options.service, source);
  ensure(
    ["collect", "sync", "rules", "discover"].includes(command),
    "unsupported selection command",
  );
  ensure(
    options.termsSha256 === undefined ||
      (typeof options.termsSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(options.termsSha256)),
    "invalid terms hash",
  );
  ensure(
    options.resume === undefined ||
      (typeof options.resume === "string" && options.resume.length > 0),
    "invalid resume ID",
  );
}
function featureItem(item: unknown) {
  return ["Feature Service", "Map Service"].includes(String(object(item).type));
}
function admitProfileItem(source: Source, item: unknown) {
  ensure(
    source !== "water" || featureItem(item),
    "Water catalog feature identity mismatch",
  );
  if (featureItem(item)) sourceService(object(item).url, source);
}
function selectionKey(source: Source, s: Selection) {
  return `${source}:${s.item}:${s.layer ?? "file"}:${s.fields?.join(",") ?? "*"}`;
}
function originalSource(
  item: unknown,
  entry: Record<string, unknown>,
  s: Selection,
) {
  if (!featureItem(item)) return `${sharing}/content/items/${s.item}/data`;
  const route = selectedService(item, entry, s);
  if (route.layer !== undefined || s.layer === undefined) return route.original;
  return route.original + "/" + s.layer;
}
async function inspectRules(
  a: Archive,
  run: string,
  item: unknown,
  entry: Record<string, unknown>,
  s: Selection,
) {
  if (!featureItem(item)) return null;
  return a.request(
    run,
    "service",
    queryUrl(selectedService(item, entry, s).root, {}),
    "json",
  );
}
function sourceOrigins(source: Source) {
  if (source === "water")
    return ["https://www.arcgis.com", "https://www.austintexas.gov"];
  if (source === "austin") return ["https://www.arcgis.com"];
  return ["https://www.arcgis.com", "https://gis.traviscountytx.gov"];
}
async function performSelection(
  a: Archive,
  run: string,
  key: string,
  source: Source,
  command: string,
  selected: Selection,
  termsSha256?: string,
) {
  const origins = sourceOrigins(source);
  await gate(a, run, origins);
  const catalog = await readCatalog(a, run, source, selected.maxPages);
  const catalogTerms = terms(await a.read(run, "site-item"));
  if (command === "discover") {
    ensure(
      catalogTerms.sha256 === termsSha256,
      "catalog usage terms changed/unapproved; use catalogTerms from rules",
    );
    return catalog;
  }
  const entry = catalogEntry(catalog.items, selected.item, selected.layer);
  if (command === "rules" && !entry)
    return {
      source,
      catalogTerms,
      terms: catalogTerms,
      selectedItemUnsupported: true,
      catalogItems: catalog.catalogItems,
    };
  ensure(entry, "item absent from authoritative catalog");
  const item = await a.request(
    run,
    "item-before",
    itemUrl(selected.item),
    "json",
    (v) => validateItem(v, selected.item),
  );
  admitProfileItem(source, item);
  const original = originalSource(item, entry, selected);
  const serviceOrigin = new URL(original).origin;
  if (!origins.includes(serviceOrigin))
    await gate(a, run, [...origins, serviceOrigin]);
  a.store.source(key, String(object(item).title), original);
  if (command === "rules")
    return {
      source,
      catalogItem: selected.item,
      terms: terms(item),
      catalogTerms,
      item,
      service: await inspectRules(a, run, item, entry, selected),
    };
  ensure(
    terms(item).sha256 === termsSha256,
    "usage terms changed/unapproved; review rules output",
  );
  if (featureItem(item)) await acquireFeatures(a, run, selected, item, entry);
  else await acquirePublished(a, run, selected, item);
  return verifySelection(a, run);
}
function validateCachedRecords(
  summary: Record<string, unknown>,
  maxRecords: number,
) {
  ensure(
    !("records" in summary) ||
      summary.records === null ||
      integer(summary.records, 0, Number.MAX_SAFE_INTEGER) <= maxRecords,
    "cached selection exceeds current record bound",
  );
}
export async function executeSelection(
  a: Archive,
  source: Source,
  command: string,
  options: Selection & { termsSha256?: string; resume?: string },
) {
  validateInvocation(source, command, options);
  const { termsSha256, resume, ...selection } = options;
  // Only persist the explicit immutable selection, not CLI bookkeeping.
  const selected: Selection = {
    item: selection.item,
    layer: selection.layer,
    service: selection.service,
    fields: selection.fields,
    pageSize: selection.pageSize,
    maxRecords: selection.maxRecords,
    maxPages: selection.maxPages,
    expandedBytes: selection.expandedBytes,
    maxMembers: selection.maxMembers,
    budget: selection.budget,
  };
  const key = selectionKey(source, selected);
  if (!a.store.db.query("SELECT 1 FROM sources WHERE id=?").get(key))
    a.store.source(
      key,
      `${source} catalog item ${selected.item}`,
      itemUrl(selected.item),
    );
  if (command === "collect" && !resume) {
    const prior = a.store.latestCollection(key);
    if (prior) {
      await a.verify();
      const summary = await verifySelection(a, prior.id, selected);
      ensure(
        same(summary, JSON.parse(prior.summary)),
        "stored summary differs from original content",
      );
      validateCachedRecords(summary, selected.maxRecords);
      await validateCachedAssertion(a, prior.id, selected);
      return { run: prior.id, reused: true, summary };
    }
  }
  let run: string;
  if (resume) {
    ensure(
      same(a.store.options(resume), { ...selected, source }),
      "resume selection/budget changed",
    );
    run = a.store.resume(resume, key, command);
  } else {
    run = a.store.start(key, command);
    a.store.saveOptions(run, { ...selected, source });
  }
  try {
    const summary = await performSelection(
      a,
      run,
      key,
      source,
      command,
      selected,
      termsSha256,
    );
    a.store.finish(run, "succeeded", undefined, summary);
    return { run, reused: false, summary };
  } catch (e) {
    a.store.finish(run, "failed", e instanceof Error ? e.message : "failed");
    throw e;
  }
}
function queries(base: string) {
  return (params: Record<string, string>) =>
    queryUrl(base + "/query", { where: "1=1", ...params });
}
async function validateCachedAssertion(a: Archive, run: string, s: Selection) {
  for (const row of a.store.observations().filter((v) => v.run === run)) {
    const cap =
      row.kind === "zip" || row.kind === "file"
        ? s.budget.zipBytes
        : s.budget.responseBytes;
    ensure(row.bytes <= cap, "cached selection exceeds current response bound");
  }
  if (!s.service) return;
  const item = object(
    await a.readExpected(run, "item-before", itemUrl(s.item), "json"),
  );
  selectedService(item, { url: item.url }, s);
}
function selectedService(
  item: unknown,
  entry: Record<string, unknown>,
  s: Selection,
) {
  const route = serviceRoute(object(item).url);
  ensure(
    s.layer === undefined ||
      serviceRoute(entry.url).layer === undefined ||
      serviceRoute(entry.url).layer === s.layer,
    "caller/advertised layer mismatch",
  );
  ensure(
    (entry.map
      ? serviceRoute(entry.url).root === route.root
      : entry.url === route.original) &&
      (!s.service || s.service === route.root || s.service === route.original),
    "catalog/item/service identity mismatch",
  );
  ensure(
    route.layer === undefined ||
      s.layer === undefined ||
      route.layer === s.layer,
    "caller/advertised layer mismatch",
  );
  return route;
}
function plan(metadata: unknown, s: Selection) {
  ensure(
    s.layer !== undefined && object(metadata).id === s.layer,
    "layer metadata identity mismatch",
  );
  const schema = layerSchema(metadata, s.fields),
    cap = object(schema.layer.advancedQueryCapabilities ?? {});
  return {
    ...schema,
    size: Math.min(s.pageSize, schema.max),
    paged: cap.supportsPagination === true && cap.supportsOrderBy === true,
  };
}
function pageQuery(p: ReturnType<typeof plan>, ids: number[], off: number) {
  return {
    outFields: p.fields.join(","),
    returnGeometry: "true",
    ...(p.paged
      ? {
          orderByFields: p.oid + " ASC",
          resultRecordCount: String(p.size),
          resultOffset: String(off),
        }
      : { objectIds: ids.slice(off, off + p.size).join(",") }),
  };
}
async function acquireFeatures(
  a: Archive,
  run: string,
  s: Selection,
  item: unknown,
  entry: Record<string, unknown>,
) {
  const base = selectedService(item, entry, s).root;
  ensure(
    s.layer !== undefined,
    "select an explicit --layer from advertised service layers",
  );
  const service = object(
    await a.request(run, "service", queryUrl(base, {}), "json"),
  );
  ensure(
    array(service.layers).some((v) => object(v).id === s.layer),
    "layer absent from service metadata",
  );
  const url = base + "/" + s.layer,
    q = queries(url),
    metadata = await a.request(run, "layer", queryUrl(url, {}), "json", (v) =>
      plan(v, s),
    ),
    p = plan(metadata, s);
  const countValue = await a.request(
      run,
      "count-before",
      q({ returnCountOnly: "true" }),
      "json",
    ),
    count = integer(object(countValue).count, 0, s.maxRecords);
  const ids = featureIds(
    await a.request(
      run,
      "ids-before",
      q({ returnIdsOnly: "true", returnGeometry: "false" }),
      "json",
    ),
    count,
    p.oid,
  );
  for (let off = 0; off < count; off += p.size) {
    ensure(
      off / p.size < s.maxPages,
      "feature page budget exhausted; incomplete",
    );
    const query = pageQuery(p, ids, off);
    await a.request(run, `page-${off}`, q(query), "json", (v) => {
      const actual = featurePage(v, metadata, p.fields, p.size);
      ensure(
        same(
          p.paged ? actual : [...actual].sort((a, b) => a - b),
          ids.slice(off, off + p.size),
        ),
        "page identities/order mismatch",
      );
      ensure(
        !object(v).exceededTransferLimit || (p.paged && off + p.size < count),
        "unexpected truncated page",
      );
    });
  }
  await a.request(run, "count-after", q({ returnCountOnly: "true" }), "json");
  await a.request(
    run,
    "ids-after",
    q({ returnIdsOnly: "true", returnGeometry: "false" }),
    "json",
  );
  await a.request(run, "layer-after", queryUrl(url, {}), "json", (v) =>
    plan(v, s),
  );
  await a.request(run, "service-after", queryUrl(base, {}), "json");
  await a.request(run, "item-after", itemUrl(s.item), "json");
}
type InterpretationBounds = Pick<Selection, "expandedBytes" | "maxMembers">;
function interpretationBounds(
  s: Selection,
  current?: InterpretationBounds,
): Selection {
  return {
    ...s,
    expandedBytes: Math.min(
      s.expandedBytes,
      current?.expandedBytes ?? s.expandedBytes,
    ),
    maxMembers: Math.min(s.maxMembers, current?.maxMembers ?? s.maxMembers),
  };
}
export async function verifySelection(
  a: Archive,
  run: string,
  current?: InterpretationBounds,
) {
  const s = a.store.options(run) as Selection & { source: Source };
  ensure(s, "missing selection checkpoint");
  validateSelection(s);
  validateSource(s.source);
  await verifyProfilePolicy(a, run);
  const expected: Record<string, string> = {
    "item-before": itemUrl(s.item),
    "item-after": itemUrl(s.item),
  };
  const read = (label: string) => {
    ensure(expected[label], "unknown checkpoint identity");
    return a.readExpected(run, label, expected[label], "json");
  };
  const item = validateItem(await read("item-before"), s.item),
    after = validateItem(await read("item-after"), s.item);
  ensure(
    stableItem(item, after, s.source),
    "item metadata changed during observation",
  );
  const catalog = await readCatalog(a, run, s.source, s.maxPages, true);
  const entry = catalogEntry(catalog.items, s.item, s.layer);
  ensure(entry, "item missing from retained catalog");
  admitProfileItem(s.source, item);
  if (["Feature Service", "Map Service"].includes(String(item.type))) {
    sourceService(item.url, s.source);
    const base = selectedService(item, entry, s).root;
    ensure(s.layer !== undefined, "missing selected layer");
    const layer = base + "/" + s.layer,
      q = queries(layer);
    Object.assign(expected, {
      service: queryUrl(base, {}),
      "service-after": queryUrl(base, {}),
      layer: queryUrl(layer, {}),
      "layer-after": queryUrl(layer, {}),
      "count-before": q({ returnCountOnly: "true" }),
      "count-after": q({ returnCountOnly: "true" }),
      "ids-before": q({ returnIdsOnly: "true", returnGeometry: "false" }),
      "ids-after": q({ returnIdsOnly: "true", returnGeometry: "false" }),
    });
    ensure(
      array(object(await read("service")).layers).some(
        (v) => object(v).id === s.layer,
      ),
      "layer absent from retained service",
    );
  }
  if (!["Feature Service", "Map Service"].includes(String(item.type)))
    return {
      source: s.source,
      ...sourcePolicy(a, run),
      ...(await verifyPublished(
        a,
        run,
        interpretationBounds(s, current),
        item,
      )),
    };
  ensure(
    same(await read("service"), await read("service-after")),
    "service identity/version changed during observation",
  );
  const metadata = await read("layer"),
    p = plan(metadata, s);
  plan(await read("layer-after"), s);
  ensure(
    same(metadata, await read("layer-after")),
    "layer/schema/version changed during observation",
  );
  const count = integer(
    object(await read("count-before")).count,
    0,
    s.maxRecords,
  );
  ensure(object(await read("count-after")).count === count, "count changed");
  const ids = featureIds(await read("ids-before"), count, p.oid);
  ensure(
    same(ids, featureIds(await read("ids-after"), count, p.oid)),
    "identities changed",
  );
  for (let off = 0; off < count; off += p.size) {
    ensure(
      off / p.size < s.maxPages,
      "feature page budget exhausted; incomplete",
    );
    expected[`page-${off}`] = queries(
      serviceRoute(item.url).root + "/" + s.layer,
    )(pageQuery(p, ids, off));
    const page = await read(`page-${off}`);
    ensure(
      same(
        p.paged
          ? featurePage(page, metadata, p.fields, p.size)
          : featurePage(page, metadata, p.fields, p.size).sort((a, b) => a - b),
        ids.slice(off, off + p.size),
      ),
      "missing/duplicate/changed feature identities",
    );
    ensure(
      !object(page).exceededTransferLimit || (p.paged && off + p.size < count),
      "truncated page",
    );
  }
  return {
    source: s.source,
    ...sourcePolicy(a, run),
    strategy: "catalog-feature-query",
    catalogItem: s.item,
    layer: s.layer,
    service: serviceRoute(item.url).root,
    serviceItemId: object(await read("service")).serviceItemId ?? null,
    records: count,
    fields: p.fields,
    spatialReference: p.sr,
    publicationDate: null,
    scope:
      "complete selected rows/native XY geometry; not transactional or historical completeness",
  };
}
