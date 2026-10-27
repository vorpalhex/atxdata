import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { makeTestDirectory } from "../support/temp-dir";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const scratch = makeTestDirectory("legistar-cli-");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(...args: string[]) {
  return Bun.spawnSync([process.execPath, "run", join(root, "src/cli.ts"), ...args], {
    cwd: scratch,
    env: { ...process.env, DATA_PATH: join(scratch, "data"), LEGISTAR_API_BASE: "http://127.0.0.1:1", HTTP_TIMEOUT_MS: "20", MAX_DOWNLOAD_RETRIES: "0" },
    timeout: 5_000,
  });
}

test("CLI help lists the supported commands without creating a database", () => {
  const result = run("--help");
  expect(result.exitCode).toBe(0);
  for (const command of ["list-meetings", "ingest-meeting", "backfill", "retry-failed"]) {
    expect(result.stdout.toString()).toContain(command);
  }
  expect(Bun.file(join(scratch, "data/legistar.sqlite")).size).toBe(0);
});

for (const value of ["12garbage", "1.5", "0", "-1", "Infinity", "9007199254740992"]) {
  test(`CLI rejects invalid event id ${value} before attempting ingestion`, () => {
    const result = run("ingest-meeting", "--event-id", value);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Invalid positive integer");
    expect(result.stdout.toString()).not.toContain("http.request");
  });
}

test("CLI rejects fractional download concurrency", () => {
  const result = run("ingest-meeting", "--concurrency", "2.5");
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("Invalid positive integer");
});
