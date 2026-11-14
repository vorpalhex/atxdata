import { test, expect } from "bun:test";
import {
  catalogURL,
  decodeCatalog,
  decodeSchema,
  decodeCount,
  revision,
} from "../src/catalog";

test("catalog bounds return source-linked Austin datasets and explicit non-exhaustiveness", () => {
  const url = new URL(catalogURL({ asset: "8c6z-qnmj", limit: 2, offset: 0 }));
  expect(url.searchParams.get("domains")).toBe("datahub.austintexas.gov");
  expect(url.searchParams.get("ids")).toBe("8c6z-qnmj");
  const item = {
    resource: { id: "8c6z-qnmj", name: "Payments", type: "dataset" },
    metadata: { domain: "datahub.austintexas.gov" },
    link: "https://datahub.austintexas.gov/d/8c6z-qnmj",
  };
  expect(
    decodeCatalog(JSON.stringify({ results: [item], resultSetSize: 1 }), 2)
      .assets[0]?.id,
  ).toBe("8c6z-qnmj");
  expect(() =>
    decodeCatalog(
      JSON.stringify({
        results: [{ ...item, metadata: { domain: "elsewhere" } }],
        resultSetSize: 1,
      }),
      2,
    ),
  ).toThrow("domain");
  expect(() =>
    decodeCatalog(
      JSON.stringify({ results: [item, item], resultSetSize: 2 }),
      1,
    ),
  ).toThrow("limit");
});

test("schema binds exact asset, fields, revision facts and supports non-sample datasets", () => {
  const raw = JSON.stringify({
    id: "abcd-1234",
    name: "Other",
    viewType: "tabular",
    rowsUpdatedAt: 123,
    columns: [{ fieldName: "amount", dataTypeName: "number" }],
  });
  const schema = decodeSchema(raw, "abcd-1234");
  expect(schema.columns[0]?.fieldName).toBe("amount");
  expect(revision(schema)).toBe(revision(decodeSchema(raw, "abcd-1234")));
  expect(() => decodeSchema(raw, "8c6z-qnmj")).toThrow("identity");
  expect(() =>
    decodeSchema(
      '{"id":"abcd-1234","viewType":"tabular","columns":[]}',
      "abcd-1234",
    ),
  ).toThrow();
});

test("count uses canonical decimal strings, rejects unsafe shapes and preserves large counts", () => {
  expect(decodeCount('[{"count":"900719925474099312345"}]')).toBe(
    "900719925474099312345",
  );
  expect(decodeCount('[{"count":123}]')).toBe("123");
  for (const text of [
    "[]",
    "{}",
    '[{"count":"01"}]',
    '[{"count":"-1"}]',
    '[{"count":"1e3"}]',
    '[{"count":"1"},{"count":"2"}]',
  ])
    expect(() => decodeCount(text)).toThrow();
});
