import { beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../../src/cli.ts");
const fixture = resolve(import.meta.dir, "../support/frontend-fixture.ts");
const monitor = resolve(import.meta.dir, "../support/stderr-monitor.ts");
const usage = `Usage: legistar-consume [options] [command]

Download Austin Legistar meeting documents to disk

Options:
  -V, --version                 output the version number
  -h, --help                    display help for command

Commands:
  list-meetings-page [options]
  list-meetings [options]
  ingest-meeting [options]
  backfill [options]
  retry-failed
  help [command]                display help for command
`;
const invalid = "error: unknown option '--invalid'\n";
const numeric = ["list-meetings", "--from=2021-01-05", "--to=2021-01-05", "--max-pages=0"];
type Sink = "healthy" | "stderr" | "stdout" | "both";
function probe(name: string, args: string[], sink: Sink = "healthy", calibration = false) {
  const root = process.env.CLI_STDERR_RECEIPTS ?? tmpdir();
  mkdirSync(root, { recursive: true });
  const cwd = mkdtempSync(join(root, name + "-"));
  const ledger = join(cwd, "uncaught.jsonl");
  const calls = join(cwd, "calls");
  writeFileSync(ledger, ""); writeFileSync(calls, "");
  const dest = join(cwd, "read-only"); writeFileSync(dest, "calibration");
  const fd = openSync(dest, "r");
  try {
    // Independent OS write proves descriptor is actually non-writable.
    expect(() => writeSync(fd, "x")).toThrow("EBADF");
    const argv = ["run", "--no-install", "--preload", monitor, "--preload", fixture, entry, ...args];
    const env = { PATH: process.env.PATH ?? "", HOME: cwd, XDG_CONFIG_HOME: join(cwd, "config"), XDG_CACHE_HOME: join(cwd, "cache"), XDG_STATE_HOME: join(cwd, "state"), DATA_PATH: join(cwd, "data"), TMPDIR: cwd, CLI_UNCAUGHT_LEDGER: ledger, CLI_FIXTURE_CALLS: calls, CLI_MONITOR_CALIBRATE: calibration ? "1" : "", LEGISTAR_API_BASE: "https://fixture.invalid/v1", MAX_DOWNLOAD_RETRIES: "0", BACKFILL_MEETING_DELAY_MS: "0", HTTP_TIMEOUT_MS: "2000" };
    const result = spawnSync(process.execPath, argv, {
      cwd, env, encoding: "utf8", timeout: 7000,
      stdio: ["ignore", sink === "stdout" || sink === "both" ? fd : "pipe", sink === "stderr" || sink === "both" ? fd : "pipe"],
    });
    const observed = readFileSync(ledger, "utf8");
    const fetched = readFileSync(calls, "utf8");
    const summaries = join(cwd, "data/runs");
    const rec = { name, argv: [process.execPath, ...argv], cwd, environment: env, sink, calibration, descriptorWriteError: "EBADF", status: result.status, signal: result.signal, spawnError: result.error?.message, stdout: result.stdout ?? "", stderr: result.stderr ?? "", observed, fetched, runtimeCreated: existsSync(join(cwd, "data")), summaries };
    if (process.env.CLI_STDERR_RECEIPTS) writeFileSync(join(cwd, "result.json"), JSON.stringify(rec, null, 2));
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return rec;
  } finally {
    closeSync(fd);
    if (!process.env.CLI_STDERR_RECEIPTS) rmSync(cwd, { recursive: true, force: true });
  }
}
function expectedFailure(result: ReturnType<typeof probe>, offline = true) {
  expect(result.status).toBe(1);
  expect(result.observed).toBe("");
  expect(result.stderr).not.toMatch(/^\s+at\s|Bun v\d|Unhandled/m);
  if (offline) {
    expect(result.fetched).toBe("");
    expect(result.runtimeCreated).toBe(false);
  }
}

beforeAll(() => {
  const result = probe("monitor-positive-calibration", ["--invalid"], "healthy", true);
  expect(result.status).toBe(1);
  const events = result.observed.trim().split("\n").map(line => JSON.parse(line));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ origin: "uncaughtException", message: "stderr monitor positive calibration" });
  expect(events[0].stack).toContain("stderr-monitor.ts");
  expect(result.fetched).toBe("");
});

for (const [name, args] of [["invalid", ["--invalid"]], ["noarg", []], ["numeric", numeric]] as const) {
  test(name + " with read-only stderr has no uncaught event", () => {
    const result = probe(name, [...args], "stderr");
    expectedFailure(result);
    expect(result.stdout).toBe("");
  });
}

test("healthy redirected parser and noarg bytes are preserved", () => {
  for (const [name, args, stderr] of [["invalid-control", ["--invalid"], invalid], ["noarg-control", [], usage]] as const) {
    const result = probe(name, [...args]);
    expectedFailure(result);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(stderr);
  }
  const result = probe("numeric-control", numeric);
  expectedFailure(result);
  expect(JSON.parse(result.stderr)).toMatchObject({ level: "error", event: "cli.failed", error: "Invalid positive integer: 0" });
});

test("help and version stdout stay successful with an unused read-only stderr", () => {
  for (const [name, args, stdout] of [["help-control", ["--help"], usage], ["version-control", ["--version"], "0.1.0\n"]] as const) {
    for (const sink of ["healthy", "stderr"] as const) {
      const result = probe(name, [...args], sink);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(stdout);
      expect(result.stderr).toBe("");
      expect(result.observed).toBe("");
      expect(result.fetched).toBe("");
      expect(result.runtimeCreated).toBe(false);
    }
  }
});

test("both bad descriptors cannot recurse or hide an output delivery failure", () => {
  for (const [name, args] of [["invalid-both", ["--invalid"]], ["noarg-both", []], ["numeric-both", numeric], ["help-both", ["--help"]]] as const) {
    const result = probe(name, [...args], "both");
    expectedFailure(result);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  }
  const result = probe("stdout-failure-stderr-control", ["--help"], "stdout");
  expectedFailure(result);
  expect(JSON.parse(result.stderr)).toMatchObject({ event: "cli.failed", error: "stdout delivery failed (EBADF)" });
});

test("domain failure retains its real reason on healthy stderr and fails quietly on bad stderr", () => {
  for (const sink of ["healthy", "stderr", "both"] as const) {
    const result = probe("domain-" + sink, ["retry-failed"], sink);
    expectedFailure(result);
    if (sink === "healthy") expect(JSON.parse(result.stderr)).toMatchObject({ event: "cli.failed", error: "retry-failed is not implemented yet" });
  }
});

test("selector warning stderr failure does not relabel completed domain work", () => {
  const args = ["ingest-meeting", "--event-id=59", "--date=ignored-invalid-date"];
  const healthy = probe("warning-control", args);
  expect(healthy.status).toBe(0);
  expect(healthy.observed).toBe("");
  expect(JSON.parse(healthy.stderr)).toMatchObject({ event: "cli.selector-precedence", selector: "event-id", ignored: "date" });
  expect(JSON.parse(healthy.stdout.trim().split("\n").at(-1)!)).toMatchObject({ event: "run.summary", status: "succeeded" });
  const result = probe("warning-stderr", args, "stderr");
  expectedFailure(result, false);
  expect(result.fetched).not.toBe("");
  expect(JSON.parse(result.stdout.trim().split("\n").at(-1)!)).toMatchObject({ event: "run.summary", status: "succeeded" });
});
