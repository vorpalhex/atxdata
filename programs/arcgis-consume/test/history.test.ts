import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";

test("offline verification rejects missing or mismatched history in both directions without repairing it", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-history-"));
  let calls = 0,
    now = 0;
  const a = await Archive.open(root, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: async () => {
      calls++;
      return Response.json({ a: 1 });
    },
  });
  try {
    a.store.source("fixture", "fixture", "https://example.invalid");
    a.store.source("other", "other", "https://other.invalid");
    const first = a.store.start("fixture", "collect");
    const second = a.store.start("fixture", "sync");
    await a.request(first, "metadata", "https://example.invalid", "json");
    await a.request(second, "metadata", "https://example.invalid", "json");
    expect((await a.verify()).files).toBe(2);
    expect(a.store.status().versions).toBe(1); // Duplicate hash uses retained first path.
    const mutations = [
      "DELETE FROM versions",
      "UPDATE versions SET source='other'",
      "UPDATE versions SET label='other'",
      "UPDATE versions SET sha256='other'",
      "UPDATE versions SET bytes=bytes+1",
      "UPDATE versions SET path='missing.body'",
      "UPDATE versions SET first_retrieved='other'",
      "DELETE FROM observations WHERE rowid=1",
      "UPDATE runs SET source='other'",
      "INSERT INTO versions SELECT source,'phantom',sha256,bytes,path,first_retrieved,publication_date FROM versions",
    ];
    for (const sql of mutations) {
      a.store.db.exec("SAVEPOINT corrupt");
      a.store.db.exec(sql);
      await expect(a.verify()).rejects.toThrow("version history");
      if (sql === "DELETE FROM versions")
        expect(a.store.status().versions).toBe(0);
      a.store.db.exec("ROLLBACK TO corrupt; RELEASE corrupt");
    }
    expect((await a.verify()).httpRequests).toBe(0);
    expect(calls).toBe(2);
    a.store.db.exec(
      "PRAGMA foreign_keys=OFF; UPDATE runs SET source='missing-source'",
    );
    await expect(a.verify()).rejects.toThrow("SQLite integrity");
    expect(calls).toBe(2);
  } finally {
    await a.close();
    await rm(root, { recursive: true });
  }
});
