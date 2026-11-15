import { test, expect } from "bun:test";
import { Collector } from "../src/collector";
import { replay } from "./collector.test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
test("collect and offline reuse require no robots transfer or receipt", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "clarity-no-robots-")),
    base = replay(),
    calls: string[] = [];
  const c = await Collector.open(root, {
    ...base,
    fetch: async (url, init) => {
      calls.push(url);
      if (url.endsWith("/robots.txt"))
        throw new Error("robots transfer forbidden");
      return base.fetch(url);
    },
  });
  try {
    await c.collect("125662");
    expect(calls).toHaveLength(10);
    expect(
      c.db.query("SELECT name FROM files WHERE name LIKE '%robots%'").all(),
    ).toEqual([]);
    await c.verify();
    expect((await c.collect("125662")).reused).toBe(true);
    expect(calls).toHaveLength(10);
  } finally {
    await c.close();
    await rm(root, { recursive: true, force: true });
  }
});
