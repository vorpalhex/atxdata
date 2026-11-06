import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
test("separate byte versions retain old files and cooldown survives closing/reopening", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-version-"));
  let now = 0,
    version = 1,
    calls = 0;
  const deps = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    fetch: async () => {
      calls++;
      return Response.json(
        { version: version++ },
        { headers: { "Retry-After": "9" } },
      );
    },
  };
  let a = await Archive.open(root, deps);
  a.store.source("tnr", "TNR", "https://example.invalid");
  const one = a.store.start("tnr", "collect");
  await a.request(one, "metadata", "https://example.invalid", "json");
  const until = a.store.notBefore();
  await a.close();
  a = await Archive.open(root, deps);
  try {
    expect(a.store.notBefore()).toBe(until);
    const two = a.store.start("tnr", "sync");
    await a.request(two, "metadata", "https://example.invalid", "json");
    expect(now).toBeGreaterThanOrEqual(until);
    expect(await a.read(one, "metadata")).toEqual({ version: 1 });
    expect(await a.read(two, "metadata")).toEqual({ version: 2 });
    expect(a.store.status().versions).toBe(2);
    expect(calls).toBe(2);
  } finally {
    await a.close();
    await rm(root, { recursive: true });
  }
});
test("serial streamed acquisition persists successful cooldown, versions and zero-HTTP checkpoints", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-test-"));
  let now = 0,
    calls = 0;
  const deps = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    random: () => 0,
    fetch: async () => {
      calls++;
      return new Response('{"value":1}', { headers: { "Retry-After": "5" } });
    },
  };
  const a = await Archive.open(root, deps);
  a.store.source("tnr", "TNR", "https://example.invalid");
  const run = a.store.start("tnr", "collect");
  expect(
    await a.request(run, "one", "https://example.invalid/one", "json"),
  ).toEqual({ value: 1 });
  expect(a.store.notBefore()).toBe(5000);
  expect(
    await a.request(run, "one", "https://example.invalid/one", "json"),
  ).toEqual({ value: 1 });
  expect(calls).toBe(1);
  await a.request(run, "two", "https://example.invalid/two", "json");
  expect(now).toBeGreaterThanOrEqual(5000);
  expect((await a.verify()).files).toBe(2);
  expect(a.store.status().versions).toBe(2);
  const row = a.store.observation(run, "one")!;
  await writeFile(join(root, row.path), "corrupt");
  await expect(a.verify()).rejects.toThrow("checksum");
  await a.close();
  await rm(root, { recursive: true });
});
