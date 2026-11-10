import { test, expect } from "bun:test";
import { mkdtemp, readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Archive, limits } from "../src/archive";

test("byte reservation exists before transport and respects ZIP, remaining and exhausted run allowances", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-reservations-"));
  let now = 0,
    calls = 0,
    expected = limits.responseBytes;
  const a = await Archive.open(root, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: async () => {
      calls++;
      const reserved = a.store.db
        .query<{ bytes: number }, []>(
          "SELECT bytes FROM attempts WHERE finished IS NULL ORDER BY rowid DESC LIMIT 1",
        )
        .get();
      expect(reserved?.bytes).toBe(expected);
      return new Response("a", {
        headers: { "content-type": "application/zip" },
      });
    },
  });
  try {
    a.store.source("fixture", "reservation", "https://example.invalid");
    const metadata = a.store.start("fixture", "diagnostic");
    await a.request(metadata, "metadata", "https://example.invalid", "text");
    expected = limits.zipBytes;
    await a.request(metadata, "zip", "https://example.invalid", "zip");
    const last = a.store.start("fixture", "diagnostic");
    const prior = a.store.attempt(
      last,
      "prior",
      "https://example.invalid",
      limits.responseBytes,
    );
    a.store.finishAttempt(prior, 200, {}, limits.totalBytes - 1, 0);
    expected = 1;
    await a.request(last, "last", "https://example.invalid", "text");
    expect(a.store.budget(last).bytes).toBe(limits.totalBytes);
    await expect(
      a.request(last, "blocked", "https://example.invalid", "text"),
    ).rejects.toThrow("ceiling");
    expect(calls).toBe(3);
  } finally {
    await a.close();
  }
});
test("dead child retains partial provenance and a conservative durable byte charge on resume", async () => {
  const root = await mkdtemp(
    join(process.env.TMPDIR!, "arcgis-crash-regression-"),
  );
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "crash-transfer.ts"), root],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await child.exited).toBe(91);
  expect(await new Response(child.stderr).text()).toBe("");
  const lock = JSON.parse(
    await readFile(join(root, ".civicclerk.lock"), "utf8"),
  );
  expect(lock.pid).toBe(child.pid);
  expect(() => process.kill(child.pid, 0)).toThrow();
  // Only this test-owned, positively dead child lock is cleared.
  await unlink(join(root, ".civicclerk.lock"));
  const parts = (await readdir(root)).filter((p) => p.endsWith(".part"));
  expect(parts.length).toBe(1);
  expect((await stat(join(root, parts[0]!))).size).toBe(4_000_000);
  const db = new Database(join(root, "state.sqlite"));
  const interrupted = db
    .query<
      { id: string; run: string; bytes: number; finished: string | null },
      []
    >("SELECT id,run,bytes,finished FROM attempts")
    .get()!;
  expect(interrupted.finished).toBeNull();
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const snapshot = () =>
    JSON.stringify(
      tables.map(({ name }) => [
        name,
        db.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
      ]),
    );
  const before = snapshot();
  db.close();
  let calls = 0;
  await expect(
    Archive.open(root, {
      fetch: async () => {
        calls++;
        return new Response("forbidden");
      },
    }),
  ).rejects.toThrow("unfinished transport timing: operator review required");
  const after = new Database(join(root, "state.sqlite"), { readonly: true });
  try {
    expect(
      JSON.stringify(
        tables.map(({ name }) => [
          name,
          after.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
        ]),
      ),
    ).toBe(before);
    const retained = after
      .query<{ bytes: number; finished: null }, [string]>(
        "SELECT bytes,finished FROM attempts WHERE id=?",
      )
      .get(interrupted.id)!;
    expect(retained.bytes).toBe(limits.responseBytes);
    expect(retained.finished).toBeNull();
    expect(calls).toBe(0);
    expect((await stat(join(root, parts[0]!))).size).toBe(4_000_000);
  } finally {
    after.close();
  }
  // No completion timing exists: retain the partial/reservation for review,
  // rather than inventing a completion timestamp to authorize a retry.
}, 15000);
