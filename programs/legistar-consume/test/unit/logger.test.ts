import { afterEach, expect, spyOn, test } from "bun:test";
import { createLogger, makeRunId } from "../../src/util/logger";

const output: string[] = [];
const original = console.log;
afterEach(() => { console.log = original; output.length = 0; });
function capture() { return spyOn(console, "log").mockImplementation((line: string) => { output.push(line); }); }

test("log identity cannot be overwritten by event metadata", () => {
  capture();
  createLogger("run-1").info("request", { ts: "fake", level: "error", event: "fake", runId: "fake", status: 200 });
  const record = JSON.parse(output[0]!);
  expect(record).toMatchObject({ level: "info", event: "request", runId: "run-1", status: 200 });
  expect(Number.isFinite(Date.parse(record.ts))).toBe(true);
});

test("all levels emit JSON and optional data/run ID are omitted", () => {
  capture();
  const logger = createLogger();
  logger.info("one"); logger.warn("two", { attempt: 1 }); logger.error("three", { error: "bad" });
  expect(output.map(line => JSON.parse(line).level)).toEqual(["info", "warn", "error"]);
  expect(JSON.parse(output[0]!)).not.toHaveProperty("runId");
  expect(JSON.parse(output[1]!).attempt).toBe(1);
  expect(JSON.parse(output[2]!).error).toBe("bad");
});

test("run IDs have explicit or default prefix, UTC timestamp and random suffix", () => {
  expect(makeRunId()).toMatch(/^run_\d{14}_[a-z0-9]{1,6}$/);
  expect(makeRunId("backfill")).toMatch(/^backfill_\d{14}_[a-z0-9]{1,6}$/);
  expect(makeRunId()).not.toBe(makeRunId());
});
