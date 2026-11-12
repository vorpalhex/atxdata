import type { Archive } from "./archive";
import { ensure, object, same } from "./check";
import {
  readCatalog,
  gate,
  validateSelection,
  type Selection,
} from "./selection";
import { itemUrl, type Source } from "./sources";
import { catalogEntry } from "./catalog";
import { terms } from "./rules";
import { verifyProfilePolicy } from "./profile-policy";

type Options = Selection & {
  termsSha256?: string;
  catalogTermsSha256?: string;
  resume?: string;
};
type Run = {
  id: string;
  source: string;
  command: string;
  status: string;
  summary: string | null;
};
const mode = "app-metadata-v1";
function runs(a: Archive) {
  return a.store.db
    .query<Run, []>(
      "SELECT id,source,command,status,summary FROM runs ORDER BY rowid",
    )
    .all();
}
function marked(a: Archive, r: Run) {
  const s = a.store.options(r.id);
  return (
    r.command === "inspect-app" ||
    r.source.endsWith(":" + mode) ||
    s?.mode === mode ||
    a.store
      .observations()
      .some((o) => o.run === r.id && o.label.startsWith("app-"))
  );
}
function validateMode(
  s: Record<string, any> | undefined,
  r: Run,
): asserts s is Record<string, any> {
  ensure(
    s &&
      s.mode === mode &&
      s.receiptVersion === 1 &&
      s.source === "austin" &&
      r.command === "inspect-app",
    "app metadata mode/receipt binding missing",
  );
}
function checkpoint(a: Archive, r: Run) {
  const s = a.store.options(r.id);
  validateMode(s, r);
  validateSelection(s.selection);
  ensure(
    r.source === `austin:${s.selection.item}:${mode}` &&
      /^[a-f0-9]{64}$/.test(s.termsSha256) &&
      /^[a-f0-9]{64}$/.test(s.catalogTermsSha256) &&
      same(s.budget, s.selection.budget),
    "app metadata immutable selection/terms missing",
  );
  if (r.status === "succeeded")
    ensure(
      r.summary &&
        object(JSON.parse(r.summary)).metadataOnly === true &&
        object(JSON.parse(r.summary)).receiptVersion === 1,
      "app metadata summary missing/downgraded",
    );
  return s as {
    mode: string;
    receiptVersion: number;
    source: Source;
    selection: Selection;
    termsSha256: string;
    catalogTermsSha256: string;
    budget: Selection["budget"];
  };
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function publishedAppUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value))
    return false;
  if (!/^https?:\/\/[^/?#]+/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.hostname.length > 0 &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}
function role(v: unknown, entry: Record<string, unknown>, id: string) {
  return (
    isRecord(v) &&
    !v.error &&
    v.id === id &&
    v.type === "Web Mapping Application" &&
    v.access === "public" &&
    publishedAppUrl(entry.url) &&
    v.url === entry.url
  );
}
function disposition(v: unknown) {
  if (isRecord(v) && Object.hasOwn(v, "error")) return "error";
  if (
    v === null ||
    v === "" ||
    (typeof v === "object" && Object.keys(v).length === 0)
  )
    return "empty";
  return "unsupported";
}
function failedWire(
  fresh: {
    status: number | null;
    finished: string | null;
    error: string | null;
  },
  error: unknown,
) {
  return (
    fresh.status === 200 &&
    fresh.finished !== null &&
    error instanceof Error &&
    fresh.error === error.message
  );
}
function newUnknownTransfer(
  a: Archive,
  run: string,
  label: string,
  before: Set<string>,
  cached: unknown,
  error: unknown,
) {
  const fresh = a.store.db
    .query<
      {
        id: string;
        status: number | null;
        error: string | null;
        finished: string | null;
      },
      [string, string]
    >(
      "SELECT id,status,error,finished FROM attempts WHERE run=? AND label=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(run, label);
  return (
    !cached &&
    fresh !== null &&
    !before.has(fresh.id) &&
    failedWire(fresh, error) &&
    !a.store.observation(run, label)
  );
}
async function json(
  a: Archive,
  run: string,
  label: string,
  url: string,
  offline: boolean,
) {
  if (offline)
    return JSON.parse(String(await a.readExpected(run, label, url, "text")));
  a.guard?.(url);
  const cached = a.store.observation(run, label);
  const before = new Set(
    a.store.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM attempts WHERE run=? AND label=?",
      )
      .all(run, label)
      .map((row) => row.id),
  );
  // JSON representation admits every JSON value. Only syntax runs inside wire admission.
  try {
    const raw = await a.request(run, label, url, "text", (v) => {
      JSON.parse(String(v));
    });
    return JSON.parse(String(raw));
  } catch (error) {
    // Only a newly dispatched, settled unsuccessful metadata transfer may
    // create this hold. Cached corruption and historical parse failures cannot.
    if (newUnknownTransfer(a, run, label, before, cached, error))
      a.store.defer(Number.MAX_SAFE_INTEGER);
    throw error;
  }
}
function receipts(a: Archive, run: string) {
  return a.store
    .observations()
    .filter((o) => o.run === run)
    .map((o) => {
      const attempt = o.path.replace(/\.body$/, "");
      ensure(
        a.store.db
          .query(
            "SELECT 1 FROM attempts WHERE id=? AND run=? AND label=? AND url=? AND status=200 AND finished IS NOT NULL AND error IS NULL",
          )
          .get(attempt, run, o.label, o.url),
        "app metadata producer binding missing",
      );
      return {
        label: o.label,
        url: o.url,
        sha256: o.sha256,
        bytes: o.bytes,
        attempt,
      };
    });
}
async function summary(a: Archive, r: Run, offline: boolean) {
  const s = checkpoint(a, r),
    selected = s.selection;
  const catalog = await readCatalog(
    a,
    r.id,
    "austin",
    selected.maxPages,
    offline,
  );
  ensure(
    terms(await a.read(r.id, "site-item")).sha256 === s.catalogTermsSha256,
    "catalog terms changed/unapproved; review catalog rules",
  );
  const entry = catalogEntry(catalog.items, selected.item);
  ensure(
    entry && role(entry, entry, selected.item),
    "catalog member is not a public Web Mapping Application with published URL",
  );
  const item = await json(a, r.id, "app-item", itemUrl(selected.item), offline);
  let outcome = "item-unavailable";
  if (isRecord(item) && Object.hasOwn(item, "error")) outcome = "item-error";
  else if (role(item, entry, selected.item)) {
    ensure(
      terms(item).sha256 === s.termsSha256,
      "item usage terms unapproved; review rules output",
    );
    outcome = disposition(
      await json(a, r.id, "app-data", itemUrl(selected.item, true), offline),
    );
  }
  await verifyProfilePolicy(a, r.id);
  const bound = receipts(a, r.id);
  const labels = new Set([
    "robots-www.arcgis.com",
    "site-item",
    "site-data",
    "catalog",
    "app-item",
    ...(outcome.startsWith("item-") ? [] : ["app-data"]),
  ]);
  ensure(
    bound.every((o) => labels.has(o.label) || /^catalog-[0-9]+$/.test(o.label)),
    "unexpected app metadata route/checkpoint",
  );
  return {
    receiptVersion: 1,
    mode,
    source: "austin",
    catalogItem: selected.item,
    catalogItems: catalog.catalogItems,
    metadataOnly: true,
    wrapperResolved: false,
    acquiredFeatures: false,
    acquiredFiles: false,
    outcome,
    receipts: bound,
    scope:
      "public application metadata only; no app schema parsing, map traversal, feature or original-file coverage",
  };
}
export async function verifyAppRuns(a: Archive) {
  const selected = runs(a).filter((r) => marked(a, r));
  // Validate discriminator and summaries for every marked run before recovery writes.
  for (const r of selected) checkpoint(a, r);
  let count = 0;
  for (const r of selected)
    if (r.status === "succeeded") {
      await a.verify();
      ensure(
        same(await summary(a, r, true), JSON.parse(r.summary!)),
        "app metadata receipt mismatch",
      );
      count++;
    }
  return count;
}
function validateAppOptions(source: Source, options: Options) {
  validateSelection(options);
  ensure(
    source === "austin" &&
      options.layer === undefined &&
      options.service === undefined &&
      options.fields === undefined &&
      /^[a-f0-9]{64}$/.test(options.termsSha256 ?? "") &&
      /^[a-f0-9]{64}$/.test(options.catalogTermsSha256 ?? ""),
    "invalid app metadata invocation",
  );
}
export async function inspectApp(a: Archive, source: Source, options: Options) {
  validateAppOptions(source, options);
  const { termsSha256, catalogTermsSha256, resume, ...selection } = options;
  const saved = {
    mode,
    receiptVersion: 1,
    source,
    selection,
    termsSha256,
    catalogTermsSha256,
    budget: selection.budget,
  };
  const key = `austin:${selection.item}:${mode}`;
  const prior = runs(a)
    .reverse()
    .find(
      (r) =>
        r.source === key &&
        r.command === "inspect-app" &&
        r.status === "succeeded",
    );
  if (prior && !resume) {
    ensure(
      same(a.store.options(prior.id), saved),
      "app metadata selection/budget/terms changed",
    );
    await verifyAppRuns(a);
    return { run: prior.id, reused: true, summary: JSON.parse(prior.summary!) };
  }
  let id: string;
  if (resume) {
    ensure(
      same(a.store.options(resume), saved),
      "resume app metadata selection/budget changed",
    );
    await verifyProfilePolicy(a, resume);
    id = a.store.resume(resume, key, "inspect-app");
  } else {
    a.store.source(key, "Austin application metadata", itemUrl(selection.item));
    id = a.store.start(key, "inspect-app");
    a.store.saveOptions(id, saved);
  }
  const r = runs(a).find((r) => r.id === id)!;
  try {
    await gate(a, id, ["https://www.arcgis.com"]);
    const result = await summary(a, r, false);
    a.store.finish(id, "succeeded", undefined, result);
    return { run: id, reused: false, summary: result };
  } catch (e) {
    a.store.finish(
      id,
      "failed",
      e instanceof Error ? e.message : "app metadata failed",
    );
    throw e;
  }
}

export async function appRules(
  a: Archive,
  run: string,
  selected: Selection,
  catalog: { items: unknown[]; catalogItems: number },
  catalogTerms: ReturnType<typeof terms>,
) {
  const entry = catalogEntry(catalog.items, selected.item);
  ensure(entry, "app-only item absent from authoritative catalog");
  const item = await json(a, run, "item-before", itemUrl(selected.item), false);
  ensure(
    role(entry, entry, selected.item) && role(item, entry, selected.item),
    "app-only rules requires a matching public Web Mapping Application and exact published URL",
  );
  return {
    source: "austin",
    catalogItem: selected.item,
    catalogItems: catalog.catalogItems,
    terms: terms(item),
    catalogTerms,
    service: null,
    appOnly: true,
    metadataOnly: true,
    wrapperResolved: false,
  };
}
