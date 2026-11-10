import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../../src/cli.ts");
function run(
  args: string[],
  initial: Record<string, string> = {},
  env: Record<string, string> = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), "leg-frontend-"));
  try {
    for (const [name, contents] of Object.entries(initial))
      writeFileSync(join(cwd, name), contents);
    const result = spawnSync(
      process.execPath,
      ["run", "--no-install", entry, ...args],
      {
        cwd,
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          HOME: cwd,
          XDG_CACHE_HOME: join(cwd, "cache"),
          DATA_PATH: join(cwd, "data"),
          HTTP_TIMEOUT_MS: "1",
          MAX_DOWNLOAD_RETRIES: "0",
          ...env,
        },
      },
    );
    return { ...result, files: readdirSync(cwd).filter((p) => p !== "cache") };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("all contextual informational paths are offline and preserve five commands", () => {
  const commands = [
    "list-meetings-page",
    "list-meetings",
    "ingest-meeting",
    "backfill",
    "retry-failed",
  ];
  for (const args of [
    ["-h"],
    ["--help"],
    ["--version"],
    ...commands.flatMap((command) => [
      [command, "-h"],
      [command, "--help"],
      ["help", command],
    ]),
  ]) {
    const result = run(args, {}, { HTTP_TIMEOUT_MS: "unusable" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      args[0] === "--version" ? "0.1.0" : "legistar-consume",
    );
    expect(result.stderr).toBe("");
    expect(result.files).toEqual([]);
  }
});

test("root protected operands cannot become command or help selectors", () => {
  for (const args of [
    ["--", "--", "help", "ingest-meeting"],
    ["help", "--", "--", "ingest-meeting"],
  ]) {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.files).toEqual([]);
  }
});

test("malformed continuation identity rejects before runtime directories", () => {
  const result = run(
    [
      "list-meetings-page",
      "--from=2021-01-05",
      "--to=2021-01-05",
      "--checkpoint",
      "new.json",
      "--resume",
      "prior.json",
    ],
    { "prior.json": JSON.stringify({ complete: false, continuation: {} }) },
  );
  expect(result.status).toBe(1);
  expect(result.files).toEqual(["prior.json"]);
});

test("invalid selection and dates reject before runtime initialization", () => {
  for (const args of [
    ["ingest-meeting"],
    ["ingest-meeting", "--date", "2021-02-29"],
    ["list-meetings", "--from", "2021-02-29", "--to", "2021-03-01"],
    ["backfill", "--from", "2021-03-02", "--to", "2021-03-01"],
    [
      "list-meetings-page",
      "--from",
      "bad",
      "--to",
      "2021-03-01",
      "--checkpoint",
      "new.json",
    ],
    ["retry-failed"],
  ]) {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).event).toBe("cli.failed");
    expect(result.files).toEqual([]);
  }
});
