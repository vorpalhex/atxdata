import { ensure, object, same } from "./check";
import {
  policyFlags,
  validatePolicyOptions,
  type PolicyOptions,
  mapsPolicy,
} from "./policy-inspection-contract";
export const wrapperMode = "app-wrapper-v1";
export const wrapperKind = "wrapper-raw-v1";
export const waiverFlag = "--acknowledge-maps-robots-omission";
export type WrapperOptions = PolicyOptions & {
  acknowledgeMapsRobotsOmission: true;
};
export function validateWrapperOptions(value: unknown): WrapperOptions {
  const v = object(value);
  ensure(
    v.acknowledgeMapsRobotsOmission === true,
    "wrapper requires explicit boolean maps robots omission acknowledgement",
  );
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
  if (command === "resolve-app" || command === "collect-app-layer") return;
  if (command !== "inspect-wrapper") {
    ensure(
      flags[waiverFlag] === undefined,
      "maps robots acknowledgement is inspect-wrapper only",
    );
    return;
  }
  ensure(
    flags[waiverFlag] === "yes",
    "inspect-wrapper requires --acknowledge-maps-robots-omission",
  );
  const { [waiverFlag]: ack, ...rest } = flags;
  const p = policyFlags("inspect-policy", source, {
    "--max-requests": "1",
    "--max-bytes": "1000000",
    ...rest,
  })!;
  return validateWrapperOptions({ ...p, acknowledgeMapsRobotsOmission: true });
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
      same(s.budget, options.budget) &&
      same(s.waiver, waiver(b, run)),
    "raw wrapper requires exact versioned operator waiver",
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
export function waiver(binding: object, run: string) {
  return {
    ...binding,
    kind: "operator-scoped-robots-omission-v1",
    acknowledged: true,
    resource: mapsPolicy,
    operation: wrapperMode,
    run,
  };
}
