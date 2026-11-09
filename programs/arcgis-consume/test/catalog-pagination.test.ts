import { test, expect } from "bun:test";
import { validateCatalogPage, serviceUrl, serviceRoute } from "../src/catalog";

test("catalog pagination accepts multiple pages and rejects cycles, total drift and duplicate identities", () => {
  const seen = new Set<string>();
  expect(
    validateCatalogPage(
      {
        total: 3,
        nextStart: 3,
        results: [{ id: "a".repeat(32) }, { id: "b".repeat(32) }],
      },
      1,
      seen,
    ),
  ).toMatchObject({ next: 3, total: 3 });
  expect(
    validateCatalogPage(
      { total: 3, nextStart: -1, results: [{ id: "c".repeat(32) }] },
      3,
      seen,
      3,
    ),
  ).toMatchObject({ next: -1 });
  for (const value of [
    { total: 4, nextStart: -1, results: [{ id: "d".repeat(32) }] },
    { total: 3, nextStart: 3, results: [{ id: "d".repeat(32) }] },
    { total: 3, nextStart: -1, results: [{ id: "a".repeat(32) }] },
  ])
    expect(() =>
      validateCatalogPage(
        value,
        3,
        new Set(["a".repeat(32), "b".repeat(32)]),
        3,
      ),
    ).toThrow();
});
test("catalog boundaries accept empty and full 100-item pages while rejecting malformed positions, IDs and false continuation", () => {
  expect(
    validateCatalogPage({ total: 0, nextStart: -1, results: [] }, 1, new Set())
      .next,
  ).toBe(-1);
  const results = Array.from({ length: 100 }, (_, i) => ({
    id: i.toString(16).padStart(32, "0"),
  }));
  expect(
    validateCatalogPage({ total: 100, nextStart: -1, results }, 1, new Set())
      .total,
  ).toBe(100);
  for (const [page, start] of [
    [{ total: 100, nextStart: -1, results }, 2],
    [
      {
        total: 101,
        nextStart: -1,
        results: [...results, { id: "f".repeat(32) }],
      },
      1,
    ],
    [{ total: 1, nextStart: -1, results: [{ id: "bad" }] }, 1],
    [{ total: 1, nextStart: -1, results: [{ id: 7 }] }, 1],
    [{ total: 1, nextStart: 2, results: [{ id: "f".repeat(32) }] }, 1],
    [{ total: 1, nextStart: 1, results: [] }, 1],
  ] as const)
    expect(() => validateCatalogPage(page, start, new Set())).toThrow();
});
test("catalog-linked service selection rejects arbitrary hosts, credentials, queries and non-service paths", () => {
  expect(
    serviceUrl(
      "https://gis.traviscountytx.gov/server1/rest/services/Other/MapServer",
    ),
  ).toEndWith("/MapServer");
  for (const url of [
    "http://gis.traviscountytx.gov/rest/services/A/FeatureServer",
    "https://127.0.0.1/rest/services/A/FeatureServer",
    "https://gis.traviscountytx.gov@evil.invalid/rest/services/A/FeatureServer",
    "https://gis.traviscountytx.gov/rest/services/A/FeatureServer?token=x",
    "https://gis.traviscountytx.gov/private",
    "https://services1.arcgis.com/private/rest/services/A/FeatureServer",
    "https://services1.arcgis.com/Tenant/arcgis/rest/services/A/FeatureServer?token=x",
    "https://user:pass@services1.arcgis.com/Tenant/arcgis/rest/services/A/FeatureServer",
    "https://services1.arcgis.com:8443/Tenant/arcgis/rest/services/A/FeatureServer",
    "https://services1.arcgis.com/Tenant/arcgis/rest/services/A/FeatureServer#x",
    "https://services1.arcgis.com/Tenant/arcgis/rest/services/A%2fB/FeatureServer",
    "https://services1.arcgis.com.evil.invalid/Tenant/arcgis/rest/services/A/FeatureServer",
    "https://taxmaps.traviscountytx.gov/rest/services/A/FeatureServer",
  ])
    expect(() => serviceUrl(url)).toThrow();
});
test("a nonterminal one-item catalog page advances exactly one identity", () => {
  const seen = new Set<string>();
  expect(
    validateCatalogPage(
      { total: 2, nextStart: 2, results: [{ id: "1".repeat(32) }] },
      1,
      seen,
    ),
  ).toMatchObject({ next: 2, total: 2 });
  expect(
    validateCatalogPage(
      { total: 2, nextStart: -1, results: [{ id: "2".repeat(32) }] },
      2,
      seen,
      2,
    ),
  ).toMatchObject({ next: -1 });
  expect(seen.size).toBe(2);
});
test("layer zero is a valid advertised identity, not a default or an inferred layer", () => {
  const root =
    "https://gis.traviscountytx.gov/server1/rest/services/Fixture/MapServer";
  expect(serviceRoute(root + "/0")).toEqual({
    original: root + "/0",
    root,
    layer: 0,
  });
  expect(serviceRoute(root).layer).toBeUndefined();
});
