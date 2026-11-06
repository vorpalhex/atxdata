import { test, expect } from "bun:test";
import { validateLayer, validateFeatures, reconcile } from "../src/geometry";
import { authoritativeIds, validateRing } from "../src/geometry";
const copy = <T>(value: T): T => structuredClone(value);
test("rejects each independent layer identity, dimension, SR, pagination, extent and schema violation", () => {
  const changes: Array<(v: typeof layer) => void> = [
    (v) => {
      v.objectIdField = "other";
    },
    (v) => {
      v.geometryType = "esriGeometryPoint";
    },
    (v) => {
      v.hasZ = true;
    },
    (v) => {
      v.hasM = true;
    },
    (v) => {
      v.extent.spatialReference.wkid = 4326;
    },
    (v) => {
      v.extent.spatialReference.latestWkid = 4326;
    },
    (v) => {
      v.advancedQueryCapabilities.supportsPagination = false;
    },
    (v) => {
      v.advancedQueryCapabilities.supportsOrderBy = false;
    },
    (v) => {
      v.extent.xmin = v.extent.xmax;
    },
    (v) => {
      v.extent.ymin = v.extent.ymax;
    },
    (v) => {
      v.fields.push(v.fields[0]);
    },
    (v) => {
      v.fields[0] = { ...v.fields[0], name: "other" };
    },
  ];
  for (const change of changes) {
    const v = copy(layer);
    change(v);
    expect(() => validateLayer(v)).toThrow();
  }
});
test("ring closure, XY ordering, every extent side and inclusive tolerance edges are checked", () => {
  const extent = { xmin: 10, ymin: 30, xmax: 20, ymax: 40 };
  const ring = [
    [11, 32],
    [12, 32],
    [12, 33],
    [11, 32],
  ];
  expect(() => validateRing(ring, extent)).not.toThrow();
  const edge = [
    [10 - 0.01, 30 - 0.01],
    [20 + 0.01, 30 - 0.01],
    [20 + 0.01, 40 + 0.01],
    [10 - 0.01, 30 - 0.01],
  ];
  expect(() => validateRing(edge, extent)).not.toThrow();
  for (const bad of [
    ring.slice(0, 3),
    [
      [11, 32],
      [11, 32],
    ],
    [
      [11, 32],
      [12, 32],
      [12, 33],
      [11, 33],
    ],
    [
      [9.98, 32],
      [12, 32],
      [12, 33],
      [9.98, 32],
    ],
    [
      [20.02, 32],
      [12, 32],
      [12, 33],
      [20.02, 32],
    ],
    [
      [11, 29.98],
      [12, 32],
      [12, 33],
      [11, 29.98],
    ],
    [
      [11, 40.02],
      [12, 32],
      [12, 33],
      [11, 40.02],
    ],
  ])
    expect(() => validateRing(bad, extent)).toThrow();
});
test("page schemas, flags, native SR, empty geometries and two-row bounds are semantic gates", () => {
  const changes: Array<(v: ReturnType<typeof page>) => void> = [
    (v) => {
      v.geometryType = "esriGeometryPoint";
    },
    (v) => {
      v.spatialReference.wkid = 4326;
    },
    (v) => {
      v.spatialReference.latestWkid = 4326;
    },
    (v) => {
      v.fields = copy(v.fields);
      v.fields[1].alias = "changed";
    },
    (v) => {
      v.fields = copy(v.fields);
      v.fields[1].type = "esriFieldTypeString";
    },
    (v) => {
      v.features = [];
    },
    (v) => {
      v.features.push(...copy(v.features), ...copy(v.features));
    },
    (v) => {
      v.features[0].geometry.rings = [];
    },
  ];
  for (const change of changes) {
    const v = copy(page());
    change(v);
    expect(() => validateFeatures(v, layer)).toThrow();
  }
  expect(
    validateFeatures({ ...page(0), exceededTransferLimit: true }, layer),
  ).toEqual([0]);
  expect(
    validateFeatures({ ...page(), exceededTransferLimit: false }, layer),
  ).toEqual([5]);
  expect(() =>
    validateFeatures({ ...page(), exceededTransferLimit: "false" }, layer),
  ).toThrow();
  const two = page();
  two.features.push(page(6).features[0]);
  expect(validateFeatures(two, layer)).toEqual([5, 6]);
});
test("authoritative counts/IDs reject every mismatch and sort numeric identities without fixture pinning", () => {
  const ids = (values: number[]) => ({
    objectIdFieldName: "OBJECTID",
    objectIds: values,
  });
  expect(authoritativeIds(ids([0, 6, 5]), 3)).toEqual([0, 5, 6]);
  for (const [value, count] of [
    [ids([5, 5]), 2],
    [ids([5]), 2],
    [{ ...ids([5]), exceededTransferLimit: true }, 1],
    [{ ...ids([5]), objectIdFieldName: "other" }, 1],
  ] as const)
    expect(() => authoritativeIds(value, count)).toThrow();
  const before = { count: 2 };
  expect(reconcile(before, ids([6, 5]), [6, 5], before, ids([5, 6]))).toEqual([
    5, 6,
  ]);
  for (const actual of [[5, 5], [7, 8], [5], [5, 6, 7]])
    expect(() =>
      reconcile(before, ids([5, 6]), actual, before, ids([5, 6])),
    ).toThrow();
  expect(() =>
    reconcile(before, ids([5, 6]), [5, 6], before, ids([5, 7])),
  ).toThrow();
  expect(() =>
    reconcile({ count: 0 }, ids([]), [], { count: 0 }, ids([])),
  ).toThrow();
});
export const fields = [
  "OBJECTID",
  "PRECINCT",
  "Sq_Mi",
  "Shape__Area",
  "Shape__Length",
].map((name) => ({
  name,
  type: name === "OBJECTID" ? "esriFieldTypeOID" : "esriFieldTypeDouble",
  alias: name,
}));
export const sr = { wkid: 102739, latestWkid: 2277 };
export const layer = {
  objectIdField: "OBJECTID",
  geometryType: "esriGeometryPolygon",
  hasZ: false,
  hasM: false,
  maxRecordCount: 2000,
  advancedQueryCapabilities: {
    supportsPagination: true,
    supportsOrderBy: true,
  },
  extent: { xmin: 0, ymin: 0, xmax: 10, ymax: 10, spatialReference: sr },
  fields,
};
export function page(id = 5) {
  return {
    geometryType: "esriGeometryPolygon",
    spatialReference: sr,
    fields,
    features: [
      {
        attributes: {
          OBJECTID: id,
          PRECINCT: 1,
          Sq_Mi: 1,
          Shape__Area: 1,
          Shape__Length: 1,
        },
        geometry: {
          rings: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ],
  };
}
test("accepts bounded native state-plane polygons and reconciles authoritative IDs, not fixture count", () => {
  validateLayer(layer);
  expect(validateFeatures(page(), layer)).toEqual([5]);
  expect(
    reconcile(
      { count: 1 },
      { objectIdFieldName: "OBJECTID", objectIds: [5] },
      [5],
      { count: 1 },
      { objectIdFieldName: "OBJECTID", objectIds: [5] },
    ),
  ).toEqual([5]);
});
