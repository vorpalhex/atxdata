import { ensure, object, array, integer, same } from "./check";
export const sharing = "https://www.arcgis.com/sharing/rest";
const service =
  "https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/Travis_County_Commissioner_Precincts/FeatureServer";
export const configs = {
  tnr: {
    label: "TNR Commissioner Precincts",
    site: "2eff5d073fca4eeb97d600cda4699e46",
    item: "a8c819373dcf4535b0a7edf0a09b7f04",
    hub: "https://tnr-traviscountytx.hub.arcgis.com/",
    strategy: "feature-query",
    service,
    layer: service + "/0",
  },
  voter: {
    label: "Election Precincts published ZIP",
    site: "7900dcb8fa674dcf93bcbbd49c29e0db",
    item: "bc55843a0d9a4044a9ba46952007c6fc",
    hub: "https://voter-registration-maps-traviscountytx.hub.arcgis.com/",
    strategy: "published-item-file",
    service: "",
    layer: "",
  },
} as const;
export type Source = keyof typeof configs;
export function source(value: unknown): Source {
  ensure(
    value === "tnr" || value === "voter",
    "supported source is tnr or voter",
  );
  return value;
}
export function itemUrl(id: string, data = false) {
  ensure(/^[a-f0-9]{32}$/.test(id), "malformed item ID");
  return `${sharing}/content/items/${id}${data ? "/data" : ""}?f=json`;
}
export function queryUrl(base: string, params: Record<string, string>) {
  const url = new URL(base);
  url.search = new URLSearchParams({ f: "json", ...params }).toString();
  return url.href;
}
function groups(data: unknown): string[] {
  const config = object(data),
    scope = object(object(object(config.catalogV2).scopes).item),
    filters = array(scope.filters);
  ensure(filters.length === 1, "unsupported catalog filter composition");
  const filter = object(filters[0]);
  const predicates = array(filter.predicates);
  ensure(predicates.length === 1, "unsupported catalog predicate composition");
  const predicate = object(predicates[0]);
  ensure(
    Object.keys(predicate).length === 1 && "group" in predicate,
    "unsupported catalog predicate",
  );
  const group = predicate.group;
  let values: unknown;
  if (Array.isArray(group)) values = group;
  else {
    const expression = object(group);
    ensure(
      Object.keys(expression).length === 1 && "any" in expression,
      "unsupported group expression",
    );
    values = expression.any;
  }
  const ids = array(values);
  ensure(ids.length >= 1 && ids.length <= 9, "catalog group ceiling");
  return ids.map((id) => {
    ensure(
      typeof id === "string" && /^[a-f0-9]{32}$/.test(id),
      "invalid catalog group",
    );
    return id;
  });
}
export function catalogQuery(source: Source, data: unknown, allTypes = false) {
  const ids = groups(data);
  ensure(new Set(ids).size === ids.length, "duplicate catalog groups");
  if (source === "voter") {
    const legacy = array(object(object(data).catalog).groups);
    ensure(
      ids.length === 1 && same(legacy, ids),
      "voter legacy/catalog scope mismatch",
    );
    return `group:${ids[0]}`;
  }
  return `(${ids.map((id) => `group:${id}`).join(" OR ")})${allTypes ? "" : ' AND type:"Feature Service"'}`;
}
export function validateCatalog(value: unknown) {
  const data = object(value),
    results = array(data.results);
  ensure(
    integer(data.total, 0, 100) === results.length && data.nextStart === -1,
    "catalog exceeds one-page scope or total mismatch",
  );
  const ids = results.map((result) => {
    const item = object(result);
    ensure(
      typeof item.id === "string" && /^[a-f0-9]{32}$/.test(item.id),
      "invalid catalog identity",
    );
    return item.id;
  });
  ensure(new Set(ids).size === ids.length, "duplicate catalog identity");
  return results;
}
export function validateItem(value: unknown, id: string) {
  const item = object(value);
  ensure(
    item.id === id && item.access === "public",
    "item identity/access mismatch",
  );
  ensure(typeof item.title === "string", "item title missing");
  return item;
}
export function validatePublishedItem(value: unknown) {
  const item = validateItem(value, configs.voter.item);
  ensure(
    item.type === "Shapefile" &&
      item.name === "Election_Precincts.zip" &&
      item.title === "Election Precincts",
    "published file identity changed",
  );
  integer(item.size, 1, 1_000_000);
  integer(item.created, 0, Number.MAX_SAFE_INTEGER);
  integer(item.modified, 0, Number.MAX_SAFE_INTEGER);
  return item;
}
export function publishedStable(before: unknown, after: unknown) {
  const a = validatePublishedItem(before),
    b = validatePublishedItem(after);
  for (const key of [
    "id",
    "created",
    "modified",
    "size",
    "type",
    "access",
    "name",
    "title",
  ])
    ensure(a[key] === b[key], "published item changed during observation");
}
export function publishedRedirect(value: unknown) {
  const location = object(value).location;
  ensure(typeof location === "string", "missing redirect");
  const url = new URL(location);
  ensure(
    url.protocol === "https:" &&
      url.hostname === "www.arcgis.com" &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/itemdata/") &&
      url.pathname.endsWith("/Election_Precincts.zip"),
    "unexpected signed redirect authority/path",
  );
  return location;
}
