import { expect, test } from "bun:test";
import { makeTestDirectory } from "../support/temp-dir";
import { tmpdir } from "node:os";
import { realpathSync, rmSync } from "node:fs";
import { relative } from "node:path";
test("fixture state respects the process temporary root", () => {
  const folder = makeTestDirectory("portable-temp-");
  try { expect(relative(realpathSync(tmpdir()), folder).startsWith("..")).toBe(false); }
  finally { rmSync(folder, { recursive: true, force: true }); }
});
