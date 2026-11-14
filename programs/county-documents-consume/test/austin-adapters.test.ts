import { expect, test } from "bun:test";
import { discover, sourceName } from "../src/adapters";
import { Engine } from "../src/engine";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

/** Authored source shape only; not a retained publisher response or coverage claim. */
test("Austin financial selector preserves city identity on a no-suffix eDIMS publication", () => {
  const source = sourceName("austin-financial-publications");
  const page =
    "https://www.austintexas.gov/budget-excellence/data-and-insights";
  const rows = discover(
    source,
    page,
    "<h1>City of Austin</h1><h2>Fiscal Year 2031</h2>" +
      "<h3>Quarterly Financial Reports</h3>" +
      '<a href="https://services.austintexas.gov/edims/document.cfm?id=123456">Second Quarter Financial Report</a>',
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    source: "austin-financial-publications",
    url: "https://services.austintexas.gov/edims/document.cfm?id=123456",
    fiscalYear: "2031",
    role: "quarterly-report",
    jurisdiction: "City of Austin",
    publisher: "City of Austin",
    administeringCounty: null,
    state: "unknown",
  });
});
test("Austin snapshots retain explicit metadata version and verify without HTTP", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "austin-metadata-"));
  const engine = await Engine.open(root);
  try {
    const source = sourceName("austin-financial-publications");
    const result = await engine.importPage(
      source,
      "https://www.austintexas.gov/budget-excellence/data-and-insights",
      '<h2>FY 2031</h2><a href="https://services.austintexas.gov/edims/document.cfm?id=123456">Quarterly Report</a>',
      "authored-fixture",
    );
    expect(
      engine.db
        .query("SELECT adapter_schema FROM snapshot_metadata WHERE snapshot=?")
        .get(result.snapshot),
    ).toEqual({ adapter_schema: 5 });
    await engine.preflight();
    expect(engine.status().attempts).toBe(0);
    expect(
      engine.list(source, { limit: 1 })[0]?.administeringCounty,
    ).toBeNull();
    const id = engine.list(source, { limit: 1 })[0]!.id;
    await expect(
      engine.acceptRendered(
        id,
        Buffer.from("invalid"),
        Buffer.from("invalid"),
        {} as never,
      ),
    ).rejects.toThrow("Austin requires text identity");
    await expect(
      engine.acceptRenderedPages(id, Buffer.from("invalid"), [], {} as never),
    ).rejects.toThrow("Austin requires text identity");
  } finally {
    await engine.close();
  }
});
