import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../src/cli.ts");
const fixture = resolve(import.meta.dir, "support/frontend-fixture.ts");
test("native list, checkpoint, ingest and help observe stdout delivery failures", () => {
  for (const args of [["--help"], ["list-meetings", "--from=2021-01-05", "--to=2021-01-05"], ["list-meetings", "--from=2021-01-05", "--to=2021-01-05", "--checkpoint", "batch.json"], ["ingest-meeting", "--event-id=59", "--output", "ARCHIVE"]]) {
    const cwd = mkdtempSync(join(tmpdir(), "civ-delivery-"));
    const dest = join(cwd, "read-only"); writeFileSync(dest, ""); const fd = openSync(dest, "r");
    try {
      const result = spawnSync(process.execPath, ["run", "--no-install", "--preload", fixture, entry, ...args.map(a => a === "ARCHIVE" ? join(cwd, "archive") : a)], {
        cwd, encoding: "utf8", timeout: 7000, stdio: ["ignore", fd, "pipe"],
        env: { ...process.env, HOME: cwd, XDG_CACHE_HOME: join(cwd, "cache"), CIVICCLERK_API_BASE: "https://fixture.invalid/v1/", HTTP_MAX_RETRIES: "0", HTTP_MIN_INTERVAL_MS: "0", HTTP_TIMEOUT_MS: "2000" },
      });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr).error).toContain("stdout");
      if (args.includes("--checkpoint")) expect(JSON.parse(readFileSync(join(cwd, "batch.json"), "utf8")).complete).toBe(true);
    } finally { closeSync(fd); rmSync(cwd, { recursive: true, force: true }); }
  }
});
