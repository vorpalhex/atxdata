import { ensure, object } from "./check";
import { validateBudget } from "./policy";
export const referenceMode = "app-reference-v1",
  referenceKind = "app-reference-raw-v1",
  referenceVersion = 2;
export type ReferenceOptions = {
  source: "austin";
  wrapperRun: string;
  wrapperSha256: string;
  parentRun: string;
  referenceSha256?: string;
  helperRun?: string;
  dependencyTermsSha256?: string;
  acknowledgeMapsRobotsOmission?: boolean;
  maxReferences: number;
  budget: {
    requests: number;
    totalBytes: number;
    responseBytes: number;
    zipBytes: number;
    retries: number;
  };
};
export function validateReferenceOptions(value: unknown): ReferenceOptions {
  const v = object(value);
  ensure(
    Object.keys(v).every((k) =>
      [
        "source",
        "wrapperRun",
        "wrapperSha256",
        "parentRun",
        "referenceSha256",
        "helperRun",
        "dependencyTermsSha256",
        "acknowledgeMapsRobotsOmission",
        "maxReferences",
        "budget",
      ].includes(k),
    ),
    "unknown reference option",
  );
  ensure(v.source === "austin", "reference requires Austin");
  for (const k of ["wrapperRun", "parentRun", "helperRun"])
    if (k !== "helperRun" || v[k] !== undefined)
      ensure(
        typeof v[k] === "string" && /^[a-f0-9-]{36}$/.test(v[k] as string),
        "invalid parent run",
      );
  for (const k of ["wrapperSha256", "referenceSha256", "dependencyTermsSha256"])
    if (k === "wrapperSha256" || v[k] !== undefined)
      ensure(
        typeof v[k] === "string" && /^[a-f0-9]{64}$/.test(v[k] as string),
        "invalid reference SHA256",
      );
  ensure(
    Number.isSafeInteger(v.maxReferences) &&
      Number(v.maxReferences) > 0 &&
      Number(v.maxReferences) <= 4096,
    "reference row ceiling",
  );
  const b = validateBudget(v.budget, true);
  ensure(
    b.retries === 0 &&
      Number(b.requests) <= 16 &&
      Number(b.totalBytes) <= 12582912 &&
      Number(b.responseBytes) <= 6291456 &&
      Number(b.zipBytes) <= 6291456,
    "reference finite operation ceiling exceeded",
  );
  return value as ReferenceOptions;
}
export function referenceOptions(
  flags: Record<string, string>,
): ReferenceOptions {
  const allowed = [
    "--archive",
    "--source",
    "--wrapper-run",
    "--wrapper-sha256",
    "--parent-run",
    "--reference-sha256",
    "--helper-run",
    "--dependency-terms-sha256",
    "--acknowledge-maps-robots-omission",
    "--max-requests",
    "--max-bytes",
    "--response-bytes",
    "--raw-bytes",
    "--max-references",
  ];
  for (const k of Object.keys(flags))
    ensure(allowed.includes(k), "reference flag refused: " + k);
  const n = (k: string, d: number) => {
    const s = flags[k];
    ensure(s === undefined || /^\d+$/.test(s), "invalid reference limit");
    return s === undefined ? d : Number(s);
  };
  return validateReferenceOptions({
    source: flags["--source"],
    wrapperRun: flags["--wrapper-run"],
    wrapperSha256: flags["--wrapper-sha256"],
    parentRun: flags["--parent-run"] ?? flags["--wrapper-run"],
    ...(flags["--helper-run"] ? { helperRun: flags["--helper-run"] } : {}),
    ...(flags["--dependency-terms-sha256"]
      ? { dependencyTermsSha256: flags["--dependency-terms-sha256"] }
      : {}),
    ...(flags["--reference-sha256"]
      ? { referenceSha256: flags["--reference-sha256"] }
      : {}),
    maxReferences: n("--max-references", 256),
    budget: {
      requests: n("--max-requests", 2),
      totalBytes: n("--max-bytes", 12582912),
      responseBytes: n("--response-bytes", 6291456),
      zipBytes: n("--raw-bytes", 6291456),
      retries: 0,
    },
  });
}
