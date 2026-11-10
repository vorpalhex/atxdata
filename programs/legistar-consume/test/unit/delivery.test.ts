import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../../src/cli.ts");
const fixture = resolve(import.meta.dir, "../support/frontend-fixture.ts");
function probe(args: string[], badOutput = false) {
  const cwd = mkdtempSync(join(tmpdir(), "leg-delivery-"));
  const dest = join(cwd, "read-only");
  writeFileSync(dest, "");
  const fd = openSync(dest, "r");
  try {
    const result = spawnSync(
      process.execPath,
      ["run", "--no-install", "--preload", fixture, entry, ...args],
      {
        cwd,
        encoding: "utf8",
        timeout: 7000,
        stdio: ["ignore", badOutput ? fd : "pipe", "pipe"],
        env: {
          ...process.env,
          HOME: cwd,
          XDG_CACHE_HOME: join(cwd, "cache"),
          DATA_PATH: join(cwd, "data"),
          LEGISTAR_API_BASE: "https://fixture.invalid/v1",
          MAX_DOWNLOAD_RETRIES: "0",
          HTTP_TIMEOUT_MS: "2000",
        },
      },
    );
    const checkpoint = args.includes("--checkpoint")
      ? readFileSync(join(cwd, "batch.json"), "utf8")
      : undefined;
    return { ...result, checkpoint };
  } finally {
    closeSync(fd);
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("both selectors keep ID precedence with a structured stderr warning", () => {
  const result = probe([
    "ingest-meeting",
    "--event-id=59",
    "--date=2040-12-31",
  ]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stderr).event).toBe("cli.selector-precedence");
  const records = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records.find((record) => record.event === "meeting.start").date).toBe(
    "2021-01-05",
  );
  expect(records.at(-1)).toMatchObject({
    event: "run.summary",
    status: "succeeded",
  });
});

test("all result and logger paths observe unwritable output and preserve checkpoint", () => {
  for (const args of [
    ["list-meetings", "--from=2021-01-05", "--to=2021-01-05"],
    [
      "list-meetings-page",
      "--from=2021-01-05",
      "--to=2021-01-05",
      "--checkpoint",
      "batch.json",
    ],
    ["ingest-meeting", "--event-id=59"],
    ["backfill", "--from=2021-01-05", "--to=2021-01-05"],
  ]) {
    const result = probe(args, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cli.failed");
    expect(result.stderr).toContain("stdout");
    expect(result.stderr).not.toContain(" at ");
    if (result.checkpoint)
      expect(JSON.parse(result.checkpoint).complete).toBe(true);
  }
});
