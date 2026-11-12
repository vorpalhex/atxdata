import { ensure, object } from "./check";
import { validateBudget } from "./policy";
export const policyMode = "wrapper-policy-v1";
export const policyKind = "policy-raw-v1";
export const mapsPolicy = "https://maps.austintexas.gov/robots.txt";
export const hubTarget = "https://geohub.austintexas.gov/";
export type PolicyOptions = {
  item: string;
  appRun: string;
  appItemSha256: string;
  budget: {
    requests: number;
    totalBytes: number;
    responseBytes: number;
    zipBytes: number;
    retries: number;
  };
};
export function validatePolicyOptions(value: unknown): PolicyOptions {
  const v = object(value);
  const b = validateBudget(v.budget, true);
  ensure(
    /^[a-f0-9]{32}$/.test(String(v.item)) &&
      /^[a-f0-9-]{36}$/.test(String(v.appRun)) &&
      /^[a-f0-9]{64}$/.test(String(v.appItemSha256)),
    "policy inspection requires exact item, app run and app-item SHA256",
  );
  ensure(
    b.retries === 0 &&
      Number(b.requests) <= 2 &&
      Number(b.totalBytes) <= 2000000 &&
      Number(b.responseBytes) <= 1000000 &&
      Number(b.zipBytes) <= 1000000,
    "policy inspection ceiling exceeded",
  );
  ensure(
    Object.keys(v).sort().join() === "appItemSha256,appRun,budget,item",
    "unexpected policy inspection option",
  );
  return v as PolicyOptions;
}
export function policyFlags(
  command: string,
  source: unknown,
  flags: Record<string, string>,
) {
  const keys = ["--app-run", "--app-item-sha256"];
  if (command !== "inspect-policy") {
    ensure(
      keys.every((k) => flags[k] === undefined),
      "policy binding flags are inspect-policy only",
    );
    return undefined;
  }
  const allowed = new Set([
    "--archive",
    "--source",
    "--item",
    ...keys,
    "--max-requests",
    "--max-bytes",
    "--response-bytes",
    "--raw-bytes",
  ]);
  ensure(
    source === "austin" && Object.keys(flags).every((k) => allowed.has(k)),
    "policy inspection requires Austin and no other selectors/acknowledgements",
  );
  const n = (key: string, fallback: number) => {
    const v = flags[key];
    ensure(v === undefined || /^\d+$/.test(v), "invalid policy budget");
    return v === undefined ? fallback : Number(v);
  };
  return validatePolicyOptions({
    item: flags["--item"],
    appRun: flags["--app-run"],
    appItemSha256: flags["--app-item-sha256"],
    budget: {
      requests: n("--max-requests", 2),
      totalBytes: n("--max-bytes", 2000000),
      responseBytes: n("--response-bytes", 1000000),
      zipBytes: n("--raw-bytes", 1000000),
      retries: 0,
    },
  });
}
