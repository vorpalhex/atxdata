import { ensure, object, same } from "./check";
import { validateSelection, type Selection } from "./selection";
export const v2Format = "json-or-empty-v2";
export type AppRun = {
  id: string;
  source: string;
  command: string;
  status: string;
  summary: string | null;
};
export type AppIntent = {
  mode: string;
  receiptVersion: number;
  appDataFormat?: string;
  source: "austin";
  selection: Selection;
  termsSha256: string;
  catalogTermsSha256: string;
  budget: Selection["budget"];
};
export function appContract(format: unknown = undefined) {
  if (format === undefined)
    return { mode: "app-metadata-v1", receiptVersion: 1 };
  ensure(format === v2Format, "unsupported app-data format");
  return {
    mode: "app-metadata-v2",
    receiptVersion: 2,
    appDataFormat: v2Format,
  };
}
function markedOptions(s: Record<string, unknown> | undefined) {
  if (!s) return false;
  return (
    String(s.mode ?? "").startsWith("app-metadata-") ||
    Object.hasOwn(s, "receiptVersion") ||
    Object.hasOwn(s, "appDataFormat")
  );
}
export function markedApp(
  r: AppRun,
  s: Record<string, unknown> | undefined,
  appLabels: boolean,
) {
  return (
    r.command === "inspect-app" ||
    r.source.includes(":app-metadata-") ||
    markedOptions(s) ||
    appLabels
  );
}

function savedContract(s: Record<string, unknown>) {
  if (s.mode === "app-metadata-v1") {
    ensure(
      s.receiptVersion === 1 && !Object.hasOwn(s, "appDataFormat"),
      "app metadata mode/receipt binding missing",
    );
    return appContract();
  }
  ensure(
    s.mode === "app-metadata-v2" &&
      s.receiptVersion === 2 &&
      s.appDataFormat === v2Format,
    "app metadata mode/receipt binding missing",
  );
  return appContract(v2Format);
}
export function validateAppCheckpoint(r: AppRun, value: unknown): AppIntent {
  const s = object(value);
  const contract = savedContract(s);
  ensure(
    s.source === "austin" && r.command === "inspect-app",
    "app metadata mode/receipt binding missing",
  );
  validateSelection(s.selection);
  const selection = s.selection;
  ensure(
    [selection.layer, selection.service, selection.fields].every(
      (value) => value === undefined,
    ),
    "app metadata selector intent mismatch",
  );
  ensure(
    r.source === `austin:${selection.item}:${contract.mode}` &&
      /^[a-f0-9]{64}$/.test(String(s.termsSha256)) &&
      /^[a-f0-9]{64}$/.test(String(s.catalogTermsSha256)) &&
      same(s.budget, selection.budget),
    "app metadata immutable selection/terms missing",
  );
  if (contract.receiptVersion === 2)
    ensure(selection.budget.retries === 0, "v2 requires zero retries");
  if (r.status === "succeeded") validateAppSummary(r, contract, selection);
  return s as AppIntent;
}
function validateSummaryScope(
  s: Record<string, unknown>,
  selection: Selection,
) {
  ensure(
    s.source === "austin" &&
      s.catalogItem === selection.item &&
      s.wrapperResolved === false &&
      s.acquiredFeatures === false &&
      s.acquiredFiles === false &&
      s.metadataOnly === true,
    "app metadata summary source/scope mismatch",
  );
}
export function validateAppSummary(
  r: AppRun,
  contract: ReturnType<typeof appContract>,
  selection: Selection,
) {
  ensure(r.summary, "app metadata summary missing/downgraded");
  const s = object(JSON.parse(r.summary));
  validateSummaryScope(s, selection);
  ensure(
    s.receiptVersion === contract.receiptVersion && s.mode === contract.mode,
    "app metadata summary missing/downgraded",
  );
  if (contract.receiptVersion === 2)
    ensure(
      s.appDataFormat === v2Format &&
        ["json", "empty-body", "not-requested"].includes(
          String(s.representation),
        ),
      "v2 app representation marker missing",
    );
  else
    ensure(
      !Object.hasOwn(s, "appDataFormat") && !Object.hasOwn(s, "representation"),
      "v1 summary format downgrade conflict",
    );
  return s;
}
