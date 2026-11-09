import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
import { Archive } from "../src/archive";
import { Adapter } from "../src/adapter";

import {
  id,
  service,
  layer,
  item,
  fixture,
  sr,
} from "./support/selection-fixture";
test("CLI catalog selection collects >10 complete rows from nondefault item/layer and reuses offline", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "selected-")),
    f = fixture();
  const args = [
    "collect",
    "--source",
    "tnr",
    "--archive",
    root,
    "--item",
    id,
    "--layer",
    "7",
    "--page-size",
    "4",
    "--terms-sha256",
    terms(item).sha256,
  ];
  const result: any = await main(args, f.deps);
  expect(result.summary).toMatchObject({
    records: 13,
    catalogItem: id,
    layer: 7,
    fields: ["FID", "LABEL"],
    spatialReference: sr,
  });
  const before = f.calls;
  const reused: any = await main(args, f.deps);
  expect(reused.reused).toBe(true);
  expect(f.calls).toBe(before);
  const archive = await Archive.open(root, f.deps);
  const identity: any = archive.store.db
    .query("SELECT original_url FROM sources WHERE id LIKE 'tnr:%'")
    .get();
  expect(identity.original_url).toBe(service + "/7");
  await archive.close();
  const verified: any = await main(["verify", "--archive", root], f.deps);
  expect(verified.collections).toBe(1);
  expect(f.calls).toBe(before);
});
test("interrupted catalog pagination resumes retained first page without another first-page request", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "catalog-resume-")),
    f = fixture();
  const fetch = f.deps.fetch;
  let fail = true;
  const calls: string[] = [];
  f.deps.fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (
      fail &&
      u.pathname.endsWith("/search") &&
      u.searchParams.get("start") === "2"
    )
      throw new Error("catalog interrupted");
    return fetch(url);
  };
  const args = [
    "rules",
    "--source",
    "tnr",
    "--archive",
    root,
    "--item",
    id,
    "--layer",
    "7",
  ];
  await expect(main(args, f.deps)).rejects.toThrow("catalog interrupted");
  const archive = await Archive.open(root, f.deps);
  const failed: any = archive.store.db
    .query("SELECT id FROM runs WHERE status='failed'")
    .get();
  const spent = archive.store.budget(failed.id);
  await archive.close();
  fail = false;
  const result: any = await main([...args, "--resume", failed.id], f.deps);
  expect(result.summary.catalogItem).toBe(id);
  expect(
    calls.filter(
      (url) =>
        new URL(url).pathname.endsWith("/search") &&
        new URL(url).searchParams.get("start") === "1",
    ),
  ).toHaveLength(1);
  const checked = await Archive.open(root, f.deps);
  expect(checked.store.budget(failed.id).requests).toBeGreaterThan(
    spent.requests,
  );
  await checked.close();
});
test("source-wide catalog discovery does not depend on a preset item still being published", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "catalog-only-")),
    f = fixture();
  const rules: any = await main(
    ["rules", "--source", "tnr", "--archive", root],
    f.deps,
  );
  expect(rules.summary.selectedItemUnsupported).toBe(true);
  const result: any = await main(
    [
      "discover",
      "--source",
      "tnr",
      "--archive",
      root,
      "--terms-sha256",
      rules.summary.catalogTerms.sha256,
    ],
    f.deps,
  );
  expect(result.summary.catalogItems).toBe(2);
});
test("selected run resumes verified pages without resetting budget and supports ID batching without pagination", async () => {
  for (const nonpaged of [false, true]) {
    const root = await mkdtemp(join(process.env.TMPDIR!, "selected-resume-")),
      f = fixture(nonpaged);
    const args = [
      "collect",
      "--source",
      "tnr",
      "--archive",
      root,
      "--item",
      id,
      "--layer",
      "7",
      "--page-size",
      "4",
      "--terms-sha256",
      terms(item).sha256,
    ];
    if (!nonpaged) {
      f.interrupt = true;
      await expect(main(args, f.deps)).rejects.toThrow("fixture interruption");
      const a = await Archive.open(root, f.deps);
      const r: any = a.store.db
        .query("SELECT id FROM runs WHERE status='failed'")
        .get();
      const attempts = a.store.status().attempts;
      await a.close();
      f.interrupt = false;
      const resumed: any = await main([...args, "--resume", r.id], f.deps);
      expect(resumed.summary.records).toBe(13);
      const check = await Archive.open(root, f.deps);
      expect(check.store.status().attempts).toBeGreaterThan(attempts);
      await check.close();
    } else expect(((await main(args, f.deps)) as any).summary.records).toBe(13);
  }
});
