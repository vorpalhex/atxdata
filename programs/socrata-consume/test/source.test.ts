import { test, expect } from "bun:test";
import {
  assetID,
  decodeRows,
  lossless,
  selection,
  resourceURL,
  object,
} from "../src/source";

test("lossless resource arrays preserve exact IDs, numeric lexemes and original row JSON", () => {
  const raw =
    '[ {":id":"row-01", "payment":9007199254740993123,"decimal":1.2300,"negative":-0,"note":"123 \\\"q\\\""} ]';
  const [row] = decodeRows(raw);
  expect(row!.id).toBe("row-01");
  expect(row!.value.payment).toBe("9007199254740993123");
  expect(row!.value.decimal).toBe("1.2300");
  expect(row!.value.negative).toBe("-0");
  expect(row!.raw).toBe(raw.slice(2, -2));
  expect(lossless('{"n":1e+30,"s":"1e+30"}')).toEqual({
    n: "1e+30",
    s: "1e+30",
  });
});

test("asset identity and explicit bounds reject malformed source before archive creation", () => {
  expect(assetID("8c6z-qnmj")).toBe("8c6z-qnmj");
  for (const id of ["8C6Z-QNMJ", "../evil", "8c6z-qnmj?x=1", ""])
    expect(() => assetID(id)).toThrow("asset");
  expect(selection({ asset: "8c6z-qnmj", maxRows: 1000000 })).toMatchObject({
    asset: "8c6z-qnmj",
    maxRows: 1000000,
    pageSize: 10000,
  });
  expect(selection({ preset: "echeckbook", maxRows: 2 })).toMatchObject({
    asset: "8c6z-qnmj",
    maxRows: 2,
  });
  for (const value of [
    { asset: "8c6z-qnmj" },
    { asset: "8c6z-qnmj", maxRows: 0 },
    { asset: "8c6z-qnmj", maxRows: 1, preset: "echeckbook" },
  ])
    expect(() => selection(value)).toThrow();
  const url = new URL(resourceURL("8c6z-qnmj", 0, 20));
  expect(url.searchParams.get("$order")).toBe(":id");
  // Publisher compiler rejects :id,*: star selection must come first.
  expect(url.searchParams.get("$select")).toBe("*, :id");
});

test("reject error envelopes, missing/duplicate IDs and malformed JSON rather than empty completion", () => {
  for (const raw of [
    "{}",
    "null",
    '[{"a":1}]',
    '[{":id":"x"},{":id":"x"}]',
    "[1]",
    '[{":id":2}]',
    '[{":id":"x"},]',
    '[{":id":"x",":id":"y"}]',
    '[{":id":"x","nested":{"a":1,"a":2}}]',
  ])
    expect(() => decodeRows(raw)).toThrow();
});

test("object admission rejects every non-object at its boundary, not through a later consumer", () => {
  for (const value of [null, [], 1, "x", false, undefined])
    expect(() => object(value)).toThrow("object");
  expect(object({ value: null })).toEqual({ value: null });
});

test("duplicate-key scanning restores parent scopes and never treats string values as keys", () => {
  expect(
    lossless('{"nested":{"a":1},"a":2,"same":"same","list":[{"a":3},{"a":4}]}'),
  ).toEqual({
    nested: { a: "1" },
    a: "2",
    same: "same",
    list: [{ a: "3" }, { a: "4" }],
  });
});

test("empty IDs and zero page sizes reject while one-character opaque IDs remain valid", () => {
  expect(() => decodeRows('[{":id":""}]')).toThrow("row ID");
  expect(decodeRows('[{":id":"x"}]')[0]!.id).toBe("x");
  expect(() =>
    selection({ asset: "8c6z-qnmj", maxRows: 1, pageSize: 0 }),
  ).toThrow("pageSize");
});
