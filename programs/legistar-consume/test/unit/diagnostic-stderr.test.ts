import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("diagnostic parser diagnostics use checked stderr, never console", () => {
  const cwd = mkdtempSync(join(tmpdir(), "diagnostic-stderr-"));
  const dest = join(cwd, "readonly");
  writeFileSync(dest, "");
  const fd = openSync(dest, "r");
  try {
    expect(() => writeSync(fd, "calibrate")).toThrow("EBADF");
    for (const bad of [false, true]) {
      const result = spawnSync(
        process.execPath,
        [
          "run",
          "--no-install",
          "--preload",
          resolve(import.meta.dir, "../support/checked-stderr-fixture.ts"),
          resolve(import.meta.dir, "../../scripts/check-legistar-api.ts"),
          "--invalid",
        ],
        {
          cwd,
          env: { ...process.env },
          encoding: "utf8",
          timeout: 7000,
          stdio: ["ignore", "pipe", bad ? fd : "pipe"],
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      if (!bad)
        expect(result.stderr).toBe(
          "check-legistar-api: diagnostic failed; use --help for usage\n",
        );
    }
  } finally {
    closeSync(fd);
    rmSync(cwd, { recursive: true, force: true });
  }
});
