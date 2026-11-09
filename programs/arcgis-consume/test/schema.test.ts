import { test, expect } from "bun:test";
import { layerSchema, featurePage } from "../src/schema";
const fields = [
  { name: "FID", alias: "ID", type: "esriFieldTypeOID" },
  { name: "LABEL", alias: "Name", type: "esriFieldTypeString" },
];
function metadata(type: string) {
  return {
    objectIdField: "FID",
    geometryType: type,
    hasZ: false,
    hasM: false,
    maxRecordCount: 100,
    extent: {
      xmin: 0,
      ymin: 0,
      xmax: 10,
      ymax: 10,
      spatialReference: { wkid: 4326 },
    },
    fields,
  };
}
test("metadata-native XY point, multipoint, polyline, polygon, envelope and null shapes retain complete typed rows", () => {
  const shapes: Record<string, unknown> = {
    Point: { x: 1, y: 2 },
    Multipoint: {
      points: [
        [1, 2],
        [2, 3],
      ],
    },
    Polyline: {
      paths: [
        [
          [1, 2],
          [2, 3],
        ],
      ],
    },
    Polygon: {
      rings: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    Envelope: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
  };
  for (const [type, geometry] of Object.entries(shapes)) {
    const layer = metadata("esriGeometry" + type),
      page = {
        geometryType: layer.geometryType,
        spatialReference: layer.extent.spatialReference,
        fields,
        features: [{ attributes: { FID: 1, LABEL: "one" }, geometry }],
      };
    expect(featurePage(page, layer, ["FID", "LABEL"], 100)).toEqual([1]);
    expect(
      featurePage(
        {
          ...page,
          features: [{ attributes: { FID: 1, LABEL: null }, geometry: null }],
        },
        layer,
        ["FID", "LABEL"],
        100,
      ),
    ).toEqual([1]);
    for (const bad of [
      { ...page, spatialReference: { wkid: 3857 } },
      { ...page, fields: [fields[0], { ...fields[1], alias: "changed" }] },
      { ...page, features: [{ attributes: { FID: 1 }, geometry }] },
      { ...page, features: [{ attributes: { FID: 1, LABEL: 7 }, geometry }] },
    ])
      expect(() => featurePage(bad, layer, ["FID", "LABEL"], 100)).toThrow();
  }
});
test("explicit projected fields require metadata names and OID; unknown dimensions/types fail truthfully", () => {
  const layer = metadata("esriGeometryPoint");
  expect(layerSchema(layer, ["FID"]).fields).toEqual(["FID"]);
  for (const value of [
    { ...layer, hasZ: true },
    { ...layer, hasM: true },
    { ...layer, geometryType: "esriGeometryMesh" },
    { ...layer, fields: [...fields, fields[0]] },
  ])
    expect(() => layerSchema(value)).toThrow();
  expect(() => layerSchema(layer, ["LABEL"])).toThrow();
  expect(() => layerSchema(layer, ["FID", "MISSING"])).toThrow();
});
test("response CRS identity matches native metadata without requiring omitted service tolerance metadata", () => {
  const layer = metadata("esriGeometryPoint");
  const enriched = {
    ...layer,
    extent: {
      ...layer.extent,
      spatialReference: { wkid: 4326, xyTolerance: 0.001, xyUnits: 1000000 },
    },
  };
  const page = {
    geometryType: layer.geometryType,
    spatialReference: { wkid: 4326 },
    fields,
    features: [
      { attributes: { FID: 1, LABEL: "one" }, geometry: { x: 1, y: 2 } },
    ],
  };
  expect(featurePage(page, enriched, ["FID", "LABEL"], 100)).toEqual([1]);
});
test("Z/M coordinate properties are rejected rather than silently labeled XY", () => {
  const layer = metadata("esriGeometryPoint"),
    page = {
      geometryType: layer.geometryType,
      spatialReference: layer.extent.spatialReference,
      fields,
      features: [
        {
          attributes: { FID: 1, LABEL: "one" },
          geometry: { x: 1, y: 2, z: 3 },
        },
      ],
    };
  expect(() => featurePage(page, layer, ["FID", "LABEL"], 100)).toThrow();
});

test("geometry validation seams reject empty, inverted, short and out-of-extent native shapes", () => {
  for (const [type, geometry] of [
    ["Point", { x: 11, y: 0 }],
    ["Point", { x: 0, y: 0, m: 1 }],
    ["Envelope", { xmin: 2, ymin: 0, xmax: 1, ymax: 1 }],
    ["Multipoint", { points: [] }],
    ["Multipoint", { points: [[0, 0, 1]] }],
    ["Polyline", { paths: [] }],
    ["Polyline", { paths: [[[0, 0]]] }],
    ["Polygon", { rings: [] }],
    [
      "Polygon",
      {
        rings: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      },
    ],
  ] as const) {
    const layer = metadata("esriGeometry" + type);
    expect(() =>
      featurePage(
        {
          geometryType: layer.geometryType,
          spatialReference: layer.extent.spatialReference,
          fields,
          features: [{ attributes: { FID: 1, LABEL: "one" }, geometry }],
        },
        layer,
        ["FID", "LABEL"],
        1,
      ),
    ).toThrow();
  }
  const layer = metadata("esriGeometryPoint");
  for (const value of [
    { ...layer, extent: { ...layer.extent, xmin: 11 } },
    { ...layer, extent: { ...layer.extent, spatialReference: {} } },
    {
      ...layer,
      fields: [{ ...fields[0], type: "esriFieldTypeInteger" }, fields[1]],
    },
    { ...layer, fields: [{ ...fields[0], name: 7 }, fields[1]] },
  ])
    expect(() => layerSchema(value)).toThrow();
  expect(
    layerSchema({
      ...layer,
      extent: {
        ...layer.extent,
        spatialReference: { wkt: 'GEOGCS["fixture"]' },
      },
    }).sr.wkt,
  ).toBe('GEOGCS["fixture"]');
});
