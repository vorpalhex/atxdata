import { ensure, object, array, finite, integer, same } from "./check";
export const selected = [
  "OBJECTID",
  "PRECINCT",
  "Sq_Mi",
  "Shape__Area",
  "Shape__Length",
];
export function validateLayer(value: unknown) {
  const layer = object(value),
    extent = object(layer.extent),
    sr = object(extent.spatialReference),
    capabilities = object(layer.advancedQueryCapabilities);
  ensure(
    layer.objectIdField === "OBJECTID" &&
      layer.geometryType === "esriGeometryPolygon" &&
      layer.hasZ === false &&
      layer.hasM === false,
    "unsupported polygon layer",
  );
  ensure(
    sr.wkid === 102739 && sr.latestWkid === 2277,
    "unexpected native spatial reference",
  );
  ensure(
    capabilities.supportsPagination === true &&
      capabilities.supportsOrderBy === true,
    "pagination/order required",
  );
  integer(layer.maxRecordCount, 2, 100000);
  for (const key of ["xmin", "ymin", "xmax", "ymax"]) finite(extent[key]);
  ensure(
    finite(extent.xmin) < finite(extent.xmax) &&
      finite(extent.ymin) < finite(extent.ymax),
    "invalid extent",
  );
  const names = array(layer.fields).map((f) => object(f).name);
  ensure(
    new Set(names).size === names.length &&
      selected.every((name) => names.includes(name)),
    "missing/duplicate layer fields",
  );
  return layer;
}
export function validateRing(value: unknown, extent: Record<string, unknown>) {
  const ring = array(value);
  ensure(
    ring.length >= 4 && same(ring[0], ring.at(-1)),
    "unclosed polygon ring",
  );
  for (const point of ring) {
    const p = array(point);
    ensure(p.length === 2, "expected XY only");
    const x = finite(p[0]),
      y = finite(p[1]);
    ensure(
      x >= finite(extent.xmin) - 0.01 &&
        x <= finite(extent.xmax) + 0.01 &&
        y >= finite(extent.ymin) - 0.01 &&
        y <= finite(extent.ymax) + 0.01,
      "coordinate outside extent",
    );
  }
}
function validatePageFields(
  page: Record<string, unknown>,
  layer: Record<string, unknown>,
) {
  const fields = array(page.fields).map(object),
    definitions = array(layer.fields).map(object);
  ensure(
    same(fields.map((f) => f.name).sort(), [...selected].sort()),
    "unexpected page fields",
  );
  for (const field of fields) {
    const original = definitions.find((f) => f.name === field.name);
    ensure(
      original &&
        field.type === original.type &&
        field.alias === original.alias,
      "field schema changed",
    );
  }
}
export function validateFeatures(value: unknown, metadata: unknown): number[] {
  const page = object(value),
    layer = validateLayer(metadata),
    extent = object(layer.extent),
    sr = object(page.spatialReference);
  ensure(
    page.geometryType === "esriGeometryPolygon" &&
      sr.wkid === 102739 &&
      sr.latestWkid === 2277,
    "unexpected page geometry/SR",
  );
  ensure(
    page.exceededTransferLimit === undefined ||
      typeof page.exceededTransferLimit === "boolean",
    "invalid transfer flag",
  );
  validatePageFields(page, layer);
  const features = array(page.features);
  ensure(
    features.length > 0 && features.length <= 2,
    "page record ceiling/empty page",
  );
  return features.map((value) => {
    const feature = object(value),
      attributes = object(feature.attributes),
      rings = array(object(feature.geometry).rings);
    ensure(
      same(Object.keys(attributes).sort(), [...selected].sort()),
      "unexpected attributes",
    );
    for (const name of selected) finite(attributes[name]);
    ensure(rings.length > 0, "empty polygon");
    for (const ring of rings) validateRing(ring, extent);
    return integer(attributes.OBJECTID, 0, Number.MAX_SAFE_INTEGER);
  });
}
export function authoritativeIds(value: unknown, count: number): number[] {
  const data = object(value);
  ensure(
    data.objectIdFieldName === "OBJECTID" && !data.exceededTransferLimit,
    "invalid/truncated IDs",
  );
  const ids = array(data.objectIds).map((id) =>
    integer(id, 0, Number.MAX_SAFE_INTEGER),
  );
  ensure(
    ids.length === count && new Set(ids).size === count,
    "count/ID mismatch",
  );
  return ids.sort((a, b) => a - b);
}
export function reconcile(
  before: unknown,
  idsBefore: unknown,
  actual: number[],
  after: unknown,
  idsAfter: unknown,
): number[] {
  const count = integer(object(before).count, 1, 10);
  ensure(object(after).count === count, "count changed");
  const ids = authoritativeIds(idsBefore, count),
    end = authoritativeIds(idsAfter, count);
  ensure(
    actual.length === count &&
      new Set(actual).size === count &&
      same(
        [...actual].sort((a, b) => a - b),
        ids,
      ) &&
      same(ids, end),
    "record identities changed/missing/duplicate",
  );
  return ids;
}
