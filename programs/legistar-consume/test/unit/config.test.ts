import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { makeTestDirectory } from "../support/temp-dir";
import { join } from "node:path";
import { loadConfig } from "../../src/config";

let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  env = { ...process.env };
  for (const name of ["LEGISTAR_CLIENT", "LEGISTAR_API_BASE", "LEGISTAR_PORTAL_BASE", "HTTP_USER_AGENT", "DATA_PATH", "DOCUMENT_STORE_PATH", "RUNS_PATH", "DATABASE_PATH", "HTTP_TIMEOUT_MS", "DOWNLOAD_CONCURRENCY_NORMAL", "DOWNLOAD_CONCURRENCY_BACKFILL", "BACKFILL_MEETING_DELAY_MS", "MAX_DOWNLOAD_RETRIES"]) delete process.env[name];
  root = makeTestDirectory("config-test-");
  process.env.DATA_PATH = join(root, "data");
});
afterEach(() => { process.env = env; rmSync(root, { recursive: true, force: true }); });

test("runsPath override wins over environment and is resolved", () => {
  process.env.RUNS_PATH = join(root, "wrong");
  const config = loadConfig({ runsPath: join(root, "chosen") });
  expect(config.runsPath).toBe(join(root, "chosen"));
  expect(existsSync(config.runsPath)).toBe(true);
  expect(existsSync(process.env.RUNS_PATH!)).toBe(false);
});

test("validates all numeric overrides before creating directories", () => {
  for (const override of [{ downloadConcurrencyNormal: 0 }, { downloadConcurrencyBackfill: 1.5 }, { maxDownloadRetries: -1 }, { maxDownloadRetries: 0.5 }, { httpTimeoutMs: 0 }, { backfillMeetingDelayMs: NaN }, { httpTimeoutMs: Infinity }]) {
    expect(() => loadConfig(override)).toThrow();
    expect(existsSync(process.env.DATA_PATH!)).toBe(false);
  }
});

test("rejects blank numeric environment values before creating directories", () => {
  process.env.MAX_DOWNLOAD_RETRIES = " ";
  expect(() => loadConfig()).toThrow("MAX_DOWNLOAD_RETRIES");
  expect(existsSync(process.env.DATA_PATH!)).toBe(false);
});

test("integer env constraints and explicit zero overrides", () => {
  process.env.MAX_DOWNLOAD_RETRIES = "1.5";
  expect(() => loadConfig()).toThrow("MAX_DOWNLOAD_RETRIES");
  const config = loadConfig({ maxDownloadRetries: 0, backfillMeetingDelayMs: 0 });
  expect(config.maxDownloadRetries).toBe(0);
  expect(config.backfillMeetingDelayMs).toBe(0);
});

test("defaults resolve beneath DATA_PATH and create nested database parent", () => {
  const config = loadConfig();
  expect(config).toMatchObject({ legistarClient: "austintexas", httpTimeoutMs: 30000, downloadConcurrencyNormal: 3, downloadConcurrencyBackfill: 1, backfillMeetingDelayMs: 3000, maxDownloadRetries: 3 });
  expect(config.databasePath).toBe(join(root, "data/legistar.sqlite"));
  expect(config.documentStorePath).toBe(join(root, "data/documents"));
  expect(config.runsPath).toBe(join(root, "data/runs"));
  const nested = loadConfig({ databasePath: join(root, "nested/db/app.sqlite") });
  expect(existsSync(join(root, "nested/db"))).toBe(true);
  expect(existsSync(nested.databasePath)).toBe(false);
});

test("all overrides take precedence over valid or invalid environment values", () => {
  process.env.LEGISTAR_CLIENT = "environment";
  process.env.LEGISTAR_API_BASE = "environment";
  process.env.LEGISTAR_PORTAL_BASE = "environment";
  process.env.HTTP_USER_AGENT = "environment";
  process.env.DATABASE_PATH = join(root, "wrong/db");
  process.env.DOCUMENT_STORE_PATH = join(root, "wrong/docs");
  process.env.RUNS_PATH = join(root, "wrong/runs");
  for (const name of ["HTTP_TIMEOUT_MS", "DOWNLOAD_CONCURRENCY_NORMAL", "DOWNLOAD_CONCURRENCY_BACKFILL", "BACKFILL_MEETING_DELAY_MS", "MAX_DOWNLOAD_RETRIES"]) process.env[name] = "invalid";
  const overrides = { legistarClient: "chosen", apiBase: "chosen-api", portalBase: "chosen-portal", userAgent: "chosen-agent", databasePath: join(root, "chosen/db/file"), documentStorePath: join(root, "chosen/docs"), runsPath: join(root, "chosen/runs"), httpTimeoutMs: 1, downloadConcurrencyNormal: 1, downloadConcurrencyBackfill: 2, backfillMeetingDelayMs: 0, maxDownloadRetries: 0 };
  expect(loadConfig(overrides)).toEqual(overrides);
  expect(existsSync(join(root, "wrong"))).toBe(false);
});

test("backfill concurrency must be positive even when zero is explicitly requested", () => {
  expect(() => loadConfig({ downloadConcurrencyBackfill: 0 })).toThrow("DOWNLOAD_CONCURRENCY_BACKFILL");
  expect(existsSync(process.env.DATA_PATH!)).toBe(false);
});

test("empty DATA_PATH deliberately resolves to the current working directory", () => {
  const cwd = process.cwd();
  try {
    process.chdir(root);
    process.env.DATA_PATH = "";
    expect(loadConfig().databasePath).toBe(join(root, "legistar.sqlite"));
  } finally {
    process.chdir(cwd);
  }
});

test("reads environment settings and accepts timer upper boundaries", () => {
  process.env.LEGISTAR_CLIENT = "env-client";
  process.env.HTTP_TIMEOUT_MS = "2147483647";
  process.env.BACKFILL_MEETING_DELAY_MS = "2147483647";
  process.env.DOWNLOAD_CONCURRENCY_NORMAL = "4";
  process.env.DOWNLOAD_CONCURRENCY_BACKFILL = "2";
  process.env.MAX_DOWNLOAD_RETRIES = "0";
  expect(loadConfig()).toMatchObject({ legistarClient: "env-client", httpTimeoutMs: 2147483647, backfillMeetingDelayMs: 2147483647, downloadConcurrencyNormal: 4, downloadConcurrencyBackfill: 2, maxDownloadRetries: 0 });
});

for (const override of [{ httpTimeoutMs: 2147483648 }, { backfillMeetingDelayMs: 2147483648 }, { maxDownloadRetries: Number.MAX_SAFE_INTEGER + 1 }, { backfillMeetingDelayMs: -1 }]) {
  test(`rejects unsafe numeric boundary ${JSON.stringify(override)} before mkdir`, () => {
    expect(() => loadConfig(override)).toThrow();
    expect(existsSync(process.env.DATA_PATH!)).toBe(false);
  });
}

for (const [name, value] of [["DOWNLOAD_CONCURRENCY_NORMAL", "0"], ["DOWNLOAD_CONCURRENCY_BACKFILL", "1.5"], ["HTTP_TIMEOUT_MS", "0"], ["MAX_DOWNLOAD_RETRIES", "-1"], ["BACKFILL_MEETING_DELAY_MS", "NaN"], ["HTTP_TIMEOUT_MS", "Infinity"]]) {
  test(`rejects ${name}=${value} before mkdir`, () => {
    process.env[name!] = value;
    expect(() => loadConfig()).toThrow(name!);
    expect(existsSync(process.env.DATA_PATH!)).toBe(false);
  });
}
