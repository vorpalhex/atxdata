import { test, expect } from "bun:test";
import { Store } from "../src/store";
test("attempt reservations require positive integral bytes and preserve a one-byte allowance", () => {
  const s = new Store(":memory:");
  s.source("tnr", "TNR", "https://example.invalid");
  const run = s.start("tnr", "collect");
  for (const allowance of [0, -1, 1.5, NaN, Infinity])
    expect(() =>
      s.attempt(run, "bad", "https://example.invalid", allowance),
    ).toThrow("reservation");
  s.attempt(run, "last-byte", "https://example.invalid", 1);
  expect(s.budget(run)).toEqual({ requests: 1, bytes: 1 });
  s.close();
});
test("legacy unfinished zero-byte attempts stop resume budgeting rather than erase unknown consumption", () => {
  const s = new Store(":memory:");
  s.source("tnr", "TNR", "https://example.invalid");
  const run = s.start("tnr", "collect");
  s.db
    .query(
      "INSERT INTO attempts(id,run,label,url,started) VALUES('legacy',?,'old','https://example.invalid','past')",
    )
    .run(run);
  expect(() => s.budget(run)).toThrow("unknown interrupted bytes");
  s.close();
});
test("resume preserves source/command ownership and refuses completed or missing runs", () => {
  const s = new Store(":memory:");
  s.source("tnr", "TNR", "https://example.invalid");
  const id = s.start("tnr", "collect");
  s.finish(id, "failed", "interruption");
  expect(s.resume(id, "tnr", "collect")).toBe(id);
  expect(() => s.resume(id, "voter", "collect")).toThrow();
  expect(() => s.resume(id, "tnr", "sync")).toThrow();
  expect(() => s.resume("missing", "tnr", "collect")).toThrow();
  s.finish(id, "succeeded", undefined, {});
  expect(() => s.resume(id, "tnr", "collect")).toThrow();
  s.close();
});
test("collection lookup prefers a newer sync while retaining prior byte versions", () => {
  const s = new Store(":memory:");
  s.source("tnr", "TNR", "https://example.invalid");
  const first = s.start("tnr", "collect");
  s.finish(first, "succeeded", undefined, { records: 1 });
  const second = s.start("tnr", "sync");
  s.finish(second, "succeeded", undefined, { records: 2 });
  expect(s.latestCollection("tnr")?.id).toBe(second);
  s.close();
});
test("SQLite preserves source identities, versions, attempts, cooldown and unfinished run status", () => {
  // Explicit controlled epoch-ms receipt time makes Retry-After5 =>9000.
  const store = new Store(":memory:", {
    now: () => 4000,
    domain: "injected-epoch-ms",
  });
  store.source("tnr", "title", "https://example.invalid/original");
  const run = store.start("tnr", "collect");
  const attempt = store.attempt(
    run,
    "metadata",
    "https://example.invalid/original",
    5_000_000,
  );
  store.finishAttempt(attempt, 200, { "retry-after": "5" }, 12, 9000, "failed");
  expect(store.notBefore()).toBe(9000);
  expect(store.status().attempts).toBe(1);
  expect(store.status().running).toBe(1);
  expect(store.integrity()).toEqual({ integrity: "ok", foreignKeys: [] });
  store.finish(run, "failed", "malformed");
  expect(store.status().running).toBe(0);
  store.close();
});
