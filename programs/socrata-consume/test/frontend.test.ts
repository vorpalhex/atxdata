import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import * as operations from "../src/collector";
import { fixture } from "./support/fixture";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");

test("imported actual parser dispatch uses real operations and checked separate output seams", async () => {
  const root = await mkdtemp(join(base, "frontend-")),
    f = fixture();
  let stdout = "",
    stderr = "";
  const deps = {
    operations: {
      ...operations,
      discover: (o: Parameters<typeof operations.discover>[0]) =>
        operations.discover(o, f.deps),
      inspect: (o: Parameters<typeof operations.inspect>[0]) =>
        operations.inspect(o, f.deps),
      collect: (o: Parameters<typeof operations.collect>[0]) =>
        operations.collect(o, f.deps),
    },
    stdout: async (t: string) => {
      stdout += t;
    },
    stderr: (t: string) => {
      stderr += t;
    },
  };
  for (const args of [
    ["discover", "--query", "payments", "--limit", "2", "--offset", "0"],
    ["inspect", "8c6z-qnmj"],
    [
      "collect",
      "--preset",
      "echeckbook",
      "--where",
      "fiscal_year = '2025'",
      "--max-rows",
      "3",
      "--page-size",
      "2",
    ],
    ["status"],
    ["verify"],
  ]) {
    stdout = "";
    stderr = "";
    expect(await main(["--json", "--archive", root, ...args], deps)).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toBeDefined();
  }
});

test("imported parser informational, invalid numeric and output failure paths are bounded", async () => {
  let stdout = "",
    stderr = "";
  const deps = {
    stdout: async (t: string) => {
      stdout += t;
    },
    stderr: (t: string) => {
      stderr += t;
    },
  };
  for (const args of [[], ["--help"], ["--version"], ["collect", "--help"]]) {
    stdout = "";
    expect(await main(args, deps)).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  }
  for (const args of [
    ["status"],
    ["wat"],
    ["discover", "--query", "x", "--limit", "0"],
    ["discover", "--query", "x", "--limit", "2", "--offset", "-1"],
  ]) {
    stderr = "";
    expect(await main(args, deps)).toBe(1);
    expect(stderr).toContain("socrata-consume");
  }
  expect(
    await main(["--version"], {
      ...deps,
      stdout: async () => {
        throw Error("authored output failure");
      },
    }),
  ).toBe(1);
  expect(stderr).toContain("output failure");
});
