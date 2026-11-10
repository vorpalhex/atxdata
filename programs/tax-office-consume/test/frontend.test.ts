import { test, expect } from "bun:test";
import { information } from "../src/frontend";

test("native public frontend matrix (Python stdlib; external TMPDIR)", () => {
  const p = Bun.spawnSync(
    ["python3", import.meta.dir + "/frontend_native.py"],
    {
      env: {
        ...process.env,
        BUN: process.execPath,
        PYTHONDONTWRITEBYTECODE: "1",
      },
      timeout: 90000,
      maxBuffer: 4194304,
    },
  );
  if (p.exitCode) console.error(p.stdout.toString(), p.stderr.toString());
  expect(p.exitCode).toBe(0);
}, 95000);
test("top-level terminator delivered by a runtime is not informational", () => {
  expect(information(["--", "--help"], {}, "")).toBeUndefined();
});
