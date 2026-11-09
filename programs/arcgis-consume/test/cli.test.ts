import { test, expect } from "bun:test";
import { parseArgs, main } from "../src/cli";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
test("CLI status and verification operate on SQLite with no source access", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-cli-"));
  const archive = await Archive.open(root);
  await archive.close();
  try {
    expect(await main(["status", "--archive", root])).toMatchObject({
      attempts: 0,
    });
    expect(await main(["verify", "--archive", root])).toMatchObject({
      httpRequests: 0,
      collections: 0,
    });
  } finally {
    await rm(root, { recursive: true });
  }
});
test("CLI has explicit supported scope and fails closed on missing budgets/approval or unknown options", async () => {
  expect(
    parseArgs([
      "collect",
      "--archive",
      "/absolute-placeholder",
      "--source",
      "tnr",
      "--terms-sha256",
      "a".repeat(64),
    ]),
  ).toMatchObject({ command: "collect", source: "tnr" });
  expect(() => parseArgs(["collect", "--source", "owners"])).toThrow();
  expect(() => parseArgs(["collect", "--all"])).toThrow();
  expect(() =>
    parseArgs(["sync", "--archive", "relative", "--source", "tnr"]),
  ).toThrow();
  expect(await main(["list"])).toHaveLength(2);
});
