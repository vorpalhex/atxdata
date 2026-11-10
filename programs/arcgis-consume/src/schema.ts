import { array, ensure, finite, integer, object, same } from "./check";
import { validateRing } from "./geometry";

function nativeExtent(value: unknown) {
  const extent = object(value),
    sr = object(extent.spatialReference);
  ensure(
    (typeof sr.wkid === "number" && Number.isSafeInteger(sr.wkid)) ||
      typeof sr.wkt === "string",
    "missing native CRS",
  );
  for (const key of ["xmin", "ymin", "xmax", "ymax"]) finite(extent[key]);
  ensure(
    finite(extent.xmin) <= finite(extent.xmax) &&
      finite(extent.ymin) <= finite(extent.ymax),
    "invalid extent",
  );
  return { extent, sr };
}
function selectedFields(layer: Record<string, unknown>, requested?: string[]) {
  ensure(typeof layer.objectIdField === "string", "missing OID field");
  const definitions = array(layer.fields).map(object),
    names = definitions.map((f) => f.name);
  ensure(
    names.every((n) => typeof n === "string") &&
      new Set(names).size === names.length,
    "invalid/duplicate fields",
  );
  ensure(
    definitions.some(
      (f) => f.name === layer.objectIdField && f.type === "esriFieldTypeOID",
    ),
    "missing OID schema",
  );
  const fields = requested ?? (names as string[]);
  ensure(
    fields.length > 0 &&
      new Set(fields).size === fields.length &&
      fields.every((n) => names.includes(n)) &&
      fields.includes(layer.objectIdField),
    "invalid field selection; include OID",
  );
  return {
    fields,
    definitions: definitions.filter((f) => fields.includes(String(f.name))),
    oid: layer.objectIdField,
  };
}
export function layerSchema(value: unknown, requested?: string[]) {
  const layer = object(value),
    native = nativeExtent(layer.extent);
  ensure(
    [
      "esriGeometryPoint",
      "esriGeometryMultipoint",
      "esriGeometryPolyline",
      "esriGeometryPolygon",
      "esriGeometryEnvelope",
    ].includes(String(layer.geometryType)),
    "unsupported geometry type",
  );
  ensure(
    layer.hasZ !== true && layer.hasM !== true,
    "unsupported Z/M dimensions; native coordinates not transformed",
  );
  return {
    layer,
    ...native,
    ...selectedFields(layer, requested),
    max: integer(layer.maxRecordCount, 1, Number.MAX_SAFE_INTEGER),
  };
}
function coordinate(value: unknown, extent: Record<string, unknown>) {
  const p = array(value);
  ensure(p.length === 2, "expected native XY");
  const x = finite(p[0]),
    y = finite(p[1]);
  ensure(
    x >= finite(extent.xmin) - 0.01 &&
      x <= finite(extent.xmax) + 0.01 &&
      y >= finite(extent.ymin) - 0.01 &&
      y <= finite(extent.ymax) + 0.01,
    "coordinate outside native extent",
  );
}
function envelopeGeometry(
  g: Record<string, unknown>,
  schema: ReturnType<typeof layerSchema>,
) {
  coordinate([g.xmin, g.ymin], schema.extent);
  coordinate([g.xmax, g.ymax], schema.extent);
  ensure(
    finite(g.xmin) <= finite(g.xmax) && finite(g.ymin) <= finite(g.ymax),
    "invalid envelope",
  );
}
function pathGeometry(
  g: Record<string, unknown>,
  schema: ReturnType<typeof layerSchema>,
) {
  const polygon = schema.layer.geometryType === "esriGeometryPolygon";
  const parts = array(g[polygon ? "rings" : "paths"]);
  ensure(parts.length > 0, "empty geometry");
  for (const part of parts) {
    if (polygon) validateRing(part, schema.extent);
    else {
      const points = array(part);
      ensure(points.length >= 2, "short path");
      for (const p of points) coordinate(p, schema.extent);
    }
  }
}
function geometry(value: unknown, schema: ReturnType<typeof layerSchema>) {
  if (value === null) return; // ArcGIS legitimately publishes null shapes; retain without inventing geometry.
  const g = object(value),
    type = schema.layer.geometryType;
  ensure(!("z" in g) && !("m" in g), "unexpected Z/M coordinate dimensions");
  if (type === "esriGeometryPoint") coordinate([g.x, g.y], schema.extent);
  else if (type === "esriGeometryEnvelope") envelopeGeometry(g, schema);
  else if (type === "esriGeometryMultipoint") {
    const points = array(g.points);
    ensure(points.length > 0, "empty multipoint");
    for (const p of points) coordinate(p, schema.extent);
  } else pathGeometry(g, schema);
}
function attribute(value: unknown, type: unknown) {
  if (value === null) return;
  if (
    [
      "esriFieldTypeOID",
      "esriFieldTypeSmallInteger",
      "esriFieldTypeInteger",
      "esriFieldTypeBigInteger",
    ].includes(String(type))
  )
    integer(value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  else if (
    [
      "esriFieldTypeSingle",
      "esriFieldTypeDouble",
      "esriFieldTypeDate",
    ].includes(String(type))
  )
    finite(value);
  else if (
    [
      "esriFieldTypeString",
      "esriFieldTypeGUID",
      "esriFieldTypeGlobalID",
      "esriFieldTypeXML",
      "esriFieldTypeDateOnly",
      "esriFieldTypeTimeOnly",
      "esriFieldTypeTimestampOffset",
    ].includes(String(type))
  )
    ensure(typeof value === "string", "invalid string attribute");
  else throw new Error("unsupported attribute field type: " + String(type));
}
function nativeReference(value: unknown, metadata: Record<string, unknown>) {
  const sr = object(value);
  return (
    (sr.wkid !== undefined
      ? sr.wkid === metadata.wkid
      : typeof sr.wkt === "string" && sr.wkt === metadata.wkt) &&
    Object.entries(sr).every(([key, value]) => same(metadata[key], value))
  );
}
export function featurePage(
  value: unknown,
  metadata: unknown,
  fields: string[],
  max: number,
) {
  const page = object(value),
    s = layerSchema(metadata, fields);
  ensure(
    page.geometryType === s.layer.geometryType &&
      nativeReference(page.spatialReference, s.sr),
    "page geometry/native CRS changed",
  );
  const definitions = array(page.fields).map(object);
  ensure(
    same(definitions.map((f) => f.name).sort(), [...fields].sort()),
    "page fields changed",
  );
  for (const field of definitions) {
    const original = s.definitions.find((f) => f.name === field.name);
    ensure(
      original &&
        same([field.type, field.alias], [original.type, original.alias]),
      "field schema changed",
    );
  }
  ensure(
    page.exceededTransferLimit === undefined ||
      typeof page.exceededTransferLimit === "boolean",
    "invalid transfer flag",
  );
  const rows = array(page.features);
  ensure(rows.length > 0 && rows.length <= max, "page count outside bounds");
  return rows.map((v) => {
    const f = object(v),
      a = object(f.attributes);
    ensure(
      same(Object.keys(a).sort(), [...fields].sort()),
      "incomplete attributes",
    );
    for (const def of s.definitions) attribute(a[String(def.name)], def.type);
    geometry(f.geometry, s);
    return integer(a[s.oid], 0, Number.MAX_SAFE_INTEGER);
  });
}
export function featureIds(value: unknown, count: number, oid: string) {
  const v = object(value);
  ensure(
    v.objectIdFieldName === oid && !v.exceededTransferLimit,
    "invalid/truncated IDs",
  );
  const ids = array(v.objectIds)
    .map((n) => integer(n, 0, Number.MAX_SAFE_INTEGER))
    .sort((a, b) => a - b);
  ensure(
    ids.length === count && new Set(ids).size === count,
    "count/ID mismatch",
  );
  return ids;
}
