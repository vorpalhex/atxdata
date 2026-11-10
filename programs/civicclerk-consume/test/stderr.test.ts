import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("CivicClerk parser errors use checked stderr rather than console", () => {
  const result = spawnSync(
    process.execPath,
    [
      "run",
      "--no-install",
      "--preload",
      resolve(
        import.meta.dir,
        "../../legistar-consume/test/support/checked-stderr-fixture.ts",
      ),
      resolve(import.meta.dir, "../src/cli.ts"),
      "--invalid",
    ],
    {
      env: { ...process.env },
      encoding: "utf8",
      timeout: 7000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: "Unknown option; use --help",
  });
});
