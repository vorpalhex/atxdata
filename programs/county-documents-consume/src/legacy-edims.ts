import type { Evidence } from "./adapters";
export const LEGACY_EDIMS_POLICY = "published-legacy-edims-https-services-v1";
export const LEGACY_METADATA_RUN =
  "discover-import:city-council-metadata7:" + LEGACY_EDIMS_POLICY;
export function legacyEndpoint(href: string): string | null {
  const m =
    /^http:\/\/(?:www|services)\.austintexas\.gov\/edims\/document\.cfm\?id=(\d+)$/.exec(
      href,
    );
  return m
    ? "https://services.austintexas.gov/edims/document.cfm?id=" + m[1]
    : null;
}
export function legacyChoice(source: string, enabled: boolean): void {
  if (
    typeof enabled !== "boolean" ||
    (enabled && source !== "austin-council-archives")
  )
    throw Error("legacy eDIMS resolution is explicit Council-only policy");
}
export function legacySelection(row: Evidence) {
  return Object.hasOwn(row, "endpointPolicy")
    ? { publishedHref: row.publishedHref, endpointPolicy: row.endpointPolicy }
    : {};
}
export function requireLegacyEvidence(row: Evidence): void {
  const p = row.endpointPolicy;
  if (!p) return;
  const resolved = legacyEndpoint(row.href),
    checks = [
      row.source === "austin-council-archives",
      row.publishedHref === row.href,
      p.schema === 1,
      p.policy === LEGACY_EDIMS_POLICY,
      p.transportUrl === row.url,
      p.legacyResolved === Boolean(resolved),
      resolved === null || resolved === row.url,
    ];
  if (!checks.every(Boolean))
    throw Error("published eDIMS endpoint-policy mismatch");
}
