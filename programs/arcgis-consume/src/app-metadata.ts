import { validateV2Ready } from "./app-preopen";
import type { AppIntent } from "./app-intent";
import { json, captureText } from "./app-capture";
import {
  appContract,
  markedApp,
  validateAppCheckpoint,
  type AppRun,
} from "./app-intent";
import { readV2AppData } from "./app-data";
import type { Archive } from "./archive";
import type { AppEvidence } from "./app-readonly";
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
  appDataFormat?: string;
};
type Run = AppRun;
function runs(a: AppEvidence) {
  return a.store.db
    .query<Run, []>(
      "SELECT id,source,command,status,summary FROM runs ORDER BY rowid",
    )
    .all();
}
function marked(a: AppEvidence, r: Run) {
  return markedApp(
    r,
    a.store.options(r.id),
    a.store
      .observations()
      .some((o) => o.run === r.id && o.label.startsWith("app-")),
  );
}
function checkpoint(a: AppEvidence, r: Run) {
  return validateAppCheckpoint(r, a.store.options(r.id));
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
function receipts(a: AppEvidence, run: string) {
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
type AppInterpretation = {
  outcome: string;
  representation: string;
  appDataReceipt?: unknown;
};
async function interpretData(
  a: AppEvidence,
  r: Run,
  s: AppIntent,
  offline: boolean,
): Promise<AppInterpretation> {
  if (s.receiptVersion === 2) {
    const data = await readV2AppData(
      a,
      r.id,
      itemUrl(s.selection.item, true),
      offline,
    );
    return {
      outcome:
        data.representation === "empty-body"
          ? "raw-empty"
          : disposition(data.value),
      representation: data.representation,
      appDataReceipt: data.receipt,
    };
  }
  return {
    outcome: disposition(
      await json(a, r.id, "app-data", itemUrl(s.selection.item, true), offline),
    ),
    representation: "not-requested",
  };
}
function representationFields(s: AppIntent, data: AppInterpretation) {
  if (s.receiptVersion !== 2) return {};
  return {
    appDataFormat: s.appDataFormat,
    representation: data.representation,
    ...(data.appDataReceipt ? { appDataReceipt: data.appDataReceipt } : {}),
  };
}
async function summary(a: AppEvidence, r: Run, offline: boolean) {
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
  let data: AppInterpretation = {
    outcome: "item-unavailable",
    representation: "not-requested",
  };
  if (isRecord(item) && Object.hasOwn(item, "error"))
    data.outcome = "item-error";
  else if (role(item, entry, selected.item)) {
    ensure(
      terms(item).sha256 === s.termsSha256,
      "item usage terms unapproved; review rules output",
    );
    data = await interpretData(a, r, s, offline);
  }
  await verifyProfilePolicy(a, r.id);
  const bound = receipts(a, r.id);
  const labels = new Set([
    "robots-www.arcgis.com",
    "site-item",
    "site-data",
    "catalog",
    "app-item",
    ...(data.outcome.startsWith("item-") ? [] : ["app-data"]),
  ]);
  ensure(
    bound.every((o) => labels.has(o.label) || /^catalog-[0-9]+$/.test(o.label)),
    "unexpected app metadata route/checkpoint",
  );
  return {
    receiptVersion: s.receiptVersion,
    mode: s.mode,
    ...representationFields(s, data),
    source: "austin",
    catalogItem: selected.item,
    catalogItems: catalog.catalogItems,
    metadataOnly: true,
    wrapperResolved: false,
    acquiredFeatures: false,
    acquiredFiles: false,
    outcome: data.outcome,
    receipts: bound,
    scope:
      "public application metadata only; no app schema parsing, map traversal, feature or original-file coverage",
  };
}

export async function verifyAppRuns(a: AppEvidence) {
  const selected = runs(a).filter((r) => marked(a, r));
  // Validate discriminator and summaries for every marked run before recovery writes.
  for (const r of selected) {
    const intent = checkpoint(a, r);
    if (intent.receiptVersion === 2)
      await validateV2Ready(a.store.db, a.root, r, intent);
  }
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
async function prepareAppOperation(
  a: Archive,
  source: Source,
  options: Options,
) {
  validateAppOptions(source, options);
  const contract = appContract(options.appDataFormat);
  if (contract.receiptVersion === 2)
    ensure(options.budget.retries === 0, "v2 requires zero retries");
  a.store.preflight();
  for (const r of runs(a).filter((r) => marked(a, r))) {
    const intent = checkpoint(a, r);
    if (intent.receiptVersion === 2)
      await validateV2Ready(a.store.db, a.root, r, intent);
  }
  return contract;
}
export async function inspectApp(a: Archive, source: Source, options: Options) {
  const contract = await prepareAppOperation(a, source, options);
  const {
    termsSha256,
    catalogTermsSha256,
    resume,
    appDataFormat,
    ...selection
  } = options;
  const saved = {
    ...contract,
    source,
    selection,
    termsSha256,
    catalogTermsSha256,
    budget: selection.budget,
  };
  const key = `austin:${selection.item}:${contract.mode}`;
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
