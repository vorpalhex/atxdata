import { array, ensure, integer, object } from "./check";

export function validateCatalogPage(
  value: unknown,
  start: number,
  seen: Set<string>,
  total?: number,
) {
  const page = object(value),
    results = array(page.results);
  const count = integer(page.total, 0, Number.MAX_SAFE_INTEGER);
  ensure(total === undefined || total === count, "catalog total changed");
  ensure(
    start === seen.size + 1 && results.length <= 100,
    "catalog page position/size mismatch",
  );
  for (const value of results) {
    const id = object(value).id;
    ensure(
      typeof id === "string" && /^[a-f0-9]{32}$/.test(id) && !seen.has(id),
      "invalid/duplicate catalog identity",
    );
    seen.add(id);
  }
  const next = integer(page.nextStart, -1, Number.MAX_SAFE_INTEGER);
  validateContinuation(next, seen.size, count, results.length);
  return { results, total: count, next };
}
function validateContinuation(
  next: number,
  size: number,
  count: number,
  received: number,
) {
  ensure(
    size <= count &&
      (next === -1
        ? size === count
        : received > 0 && next === size + 1 && size < count),
    "catalog continuation/completeness mismatch",
  );
}
function serviceAuthority(url: URL) {
  return (
    url.hostname === "gis.traviscountytx.gov" ||
    (url.hostname === "services1.arcgis.com" &&
      /^\/[A-Za-z0-9]+\/arcgis\/rest\/services\//.test(url.pathname))
  );
}

export function serviceUrl(value: unknown): string {
  ensure(typeof value === "string", "catalog item has no service URL");
  const url = new URL(value);
  ensure(
    url.protocol === "https:" &&
      serviceAuthority(url) &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/[^?#]*rest\/services\/.+\/(FeatureServer|MapServer)(\/\d+)?$/.test(
        url.pathname,
      ) &&
      !/%|\\/.test(url.pathname),
    "unsupported service authority/path; no arbitrary URL acquisition",
  );
  return url.href;
}

export function serviceRoute(value: unknown) {
  const original = serviceUrl(value);
  const suffix = original.match(/\/(\d+)$/);
  const layer = suffix
    ? integer(Number(suffix[1]), 0, Number.MAX_SAFE_INTEGER)
    : undefined;
  return {
    original,
    root: suffix ? original.slice(0, -suffix[0].length) : original,
    layer,
  };
}
