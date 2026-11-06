import { test, expect } from "bun:test";
import {
  catalogQuery,
  configs,
  validateCatalog,
  validateItem,
} from "../src/sources";
test("one adapter applies different hub catalog predicates and never repairs service item identity", () => {
  const filters = [
    { predicates: [{ group: { any: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] } }] },
  ];
  expect(
    catalogQuery("tnr", { catalogV2: { scopes: { item: { filters } } } }),
  ).toBe('(group:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) AND type:"Feature Service"');
  expect(
    catalogQuery("voter", {
      catalog: { groups: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] },
      catalogV2: {
        scopes: {
          item: {
            filters: [
              { predicates: [{ group: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] }] },
            ],
          },
        },
      },
    }),
  ).toBe("group:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  expect(() =>
    validateItem({ id: "wrong", access: "public" }, configs.tnr.item),
  ).toThrow();
  expect(() =>
    validateCatalog({ total: 1, nextStart: 2, results: [{ id: "a" }] }),
  ).toThrow();
  expect(configs.tnr.layer).toEndWith("FeatureServer/0");
});
