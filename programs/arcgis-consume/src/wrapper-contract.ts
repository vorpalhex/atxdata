import { ensure, object, same } from "./check";
import {
  policyFlags,
  validatePolicyOptions,
  type PolicyOptions,
} from "./policy-inspection-contract";
export const wrapperMode = "app-wrapper-v1";
export const wrapperKind = "wrapper-raw-v1";
export const waiverFlag = "--acknowledge-maps-robots-omission";
export type WrapperOptions = PolicyOptions & {
  acknowledgeMapsRobotsOmission?: boolean;
};
export function validateWrapperOptions(value: unknown): WrapperOptions {
  const v = object(value);
  const { acknowledgeMapsRobotsOmission, ...selection } = v;
  const p = validatePolicyOptions(selection);
  ensure(
    p.budget.requests === 1 && p.budget.totalBytes <= 1000000,
    "wrapper ceiling exceeded: one request and 1000000 decoded bytes maximum",
  );
  return value as WrapperOptions;
}
export function wrapperFlags(
  command: string,
  source: unknown,
  flags: Record<string, string>,
) {
  if (command !== "inspect-wrapper") return;
  const { [waiverFlag]: legacy, ...rest } = flags;
  const p = policyFlags("inspect-policy", source, {
    "--max-requests": "1",
    "--max-bytes": "1000000",
    ...rest,
  })!;
  return validateWrapperOptions(p);
}
export function validateWrapperCapture(
  value: unknown,
  run: string,
  url: string,
  label: string,
) {
  const s = object(value),
    options = validateWrapperOptions(s.selection),
    b = object(s.binding);
  ensure(
    s.mode === wrapperMode &&
      s.wrapperReceiptVersion === 1 &&
      s.wireKind === wrapperKind &&
      s.source === "austin" &&
      same(s.budget, options.budget),
    "raw wrapper requires exact versioned intent",
  );
  ensure(
    b.source === "austin" &&
      b.item === options.item &&
      b.appRun === options.appRun &&
      b.appItemSha256 === options.appItemSha256 &&
      b.publishedURL === url &&
      admittedWrapperURL(url) &&
      label === "wrapper-html" &&
      [1, 2].includes(Number(b.appReceiptVersion)) &&
      /^[a-f0-9]{64}$/.test(String(b.termsSha256)) &&
      /^[a-f0-9]{64}$/.test(String(b.catalogTermsSha256)),
    "raw wrapper source/URL binding refused",
  );
}
export function admittedWrapperURL(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("https://maps.austintexas.gov/") ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  )
    return false;
  try {
    const u = new URL(value);
    return (
      u.origin === "https://maps.austintexas.gov" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.href === value &&
      u.pathname !== "/robots.txt"
    );
  } catch {
    return false;
  }
}
