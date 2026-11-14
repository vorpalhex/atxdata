import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { catalogURL, decodeCatalog, schemaURL } from "../src/catalog";
import { origin, catalogOrigin } from "../src/source";
import { admitted } from "../src/transport";
import { discover, collect, verify } from "../src/collector";
import { fixture } from "./support/fixture";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");
// Authored minimal projection of chief's retained current-domain catalog identity.
// Not a raw source original or acquired row data.
const item = {
  resource: {
    id: "8c6z-qnmj",
    name: "Authored payment dataset",
    type: "dataset",
    provenance: "official",
  },
  metadata: { domain: "datahub.austintexas.gov" },
  link: "https://datahub.austintexas.gov/Budget-and-Finance/Austin-Finance-Online-eCheckbook/8c6z-qnmj",
};
const body = (entry = item) =>
  JSON.stringify({ results: [entry], resultSetSize: 1 });
test("current publisher and catalog share evidenced authority and preserve published asset link", () => {
  expect(origin).toBe("https://datahub.austintexas.gov");
  expect(catalogOrigin).toBe(origin);
  const url = new URL(catalogURL({ asset: "8c6z-qnmj", limit: 1, offset: 0 }));
  expect(url.origin).toBe(origin);
  expect(url.searchParams.get("domains")).toBe("datahub.austintexas.gov");
  expect(decodeCatalog(body(), 1).assets[0]?.link).toBe(item.link);
  expect(new URL(schemaURL("8c6z-qnmj")).origin).toBe(origin);
  expect(() =>
    admitted("https://data.austintexas.gov/resource/8c6z-qnmj.json"),
  ).toThrow("unsupported source URL");
  expect(() => admitted("https://api.us.socrata.com/api/catalog/v1")).toThrow(
    "unsupported source URL",
  );
});
test("current catalog rejects old aliases and mismatched asset links, credentials or suffixes", () => {
  for (const domain of ["data.austintexas.gov", "elsewhere.test"])
    expect(() =>
      decodeCatalog(body({ ...item, metadata: { domain } }), 1),
    ).toThrow("domain");
  for (const link of [
    "https://data.austintexas.gov/d/8c6z-qnmj",
    "https://datahub.austintexas.gov/d/abcd-1234",
    "https://user@datahub.austintexas.gov/d/8c6z-qnmj",
    item.link + "?other=1",
    item.link + "#alias",
    "https://datahub.austintexas.gov/",
  ])
    expect(() => decodeCatalog(body({ ...item, link }), 1)).toThrow(
      "link mismatch",
    );
});
test("ordinary discovery supports a second asset while shared-origin collection has one policy request", async () => {
  const root = mkdtempSync(join(base, "current-source-")),
    f = fixture("uirm-2zvd", 3, null);
  const result = await discover(
    { root, query: "authored second dataset", limit: 1 },
    f.deps,
  );
  expect(result.assets[0]?.id).toBe("uirm-2zvd");
  const receipt = await collect(
    { root, asset: "uirm-2zvd", maxRows: 3, pageSize: 2 },
    f.deps,
  );
  expect(receipt.status).toBe("complete");
  expect(
    f.calls.every(
      (u) => new URL(u).origin === "https://datahub.austintexas.gov",
    ),
  ).toBe(true);
  expect(
    f.calls.filter((u) => new URL(u).pathname === "/robots.txt").length,
  ).toBe(1);
  const count = f.calls.length;
  expect(
    (
      await collect(
        { root, asset: "uirm-2zvd", maxRows: 3, pageSize: 2 },
        f.deps,
      )
    ).reused,
  ).toBe(true);
  expect((await verify(root)).rows).toBe(3);
  expect(f.calls.length).toBe(count);
});
