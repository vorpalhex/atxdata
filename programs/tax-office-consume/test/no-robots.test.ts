import { test, expect } from "bun:test";
import { Collector } from "../src/collector";
import { collect } from "../src/live";
import { discover, collectExport } from "../src/export-live";
import { sample, pdf, temp } from "./collector.test";
import { ROUTES } from "../src/source";
import { join } from "node:path";
import { rm } from "node:fs/promises";
test("semantic and raw live acquisition and verification need no robots transfer or receipt", async () => {
  const root = await temp();
  let now = 100000;
  const calls: string[] = [];
  const c = await Collector.open(join(root, "archive"), {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    random: () => 0,
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith("/robots.txt") || url.endsWith("/404"))
        throw new Error("robots transfer forbidden");
      return new Response(
        url === ROUTES.discovery
          ? '<a href="/voterdata/TaxDelqOpenData.csv">CSV</a><a href="/pages/DelinquentFileLayout.php">layout</a>'
          : url === ROUTES.csv
            ? sample()
            : pdf,
      );
    },
  });
  try {
    await collect(c, "delinquency", 1, true);
    expect(calls).toEqual([ROUTES.discovery, ROUTES.csv, ROUTES.layout]);
    const catalog = await discover(c);
    await collectExport(c, catalog.items[0]!.id);
    await c.verify();
    expect(
      c.db.query("SELECT * FROM attempts WHERE kind='robots'").all(),
    ).toEqual([]);
    const count = calls.length;
    await collect(c, "delinquency", 1, false);
    await collectExport(c, catalog.items[0]!.id);
    expect(calls).toHaveLength(count);
  } finally {
    await c.close();
    await rm(root, { recursive: true, force: true });
  }
});
