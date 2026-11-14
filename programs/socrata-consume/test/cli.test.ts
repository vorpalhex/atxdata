import { test, expect } from "bun:test";
import { mkdtemp, access } from "node:fs/promises";
import { join, resolve } from "node:path";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");
const cli = resolve(import.meta.dir, "../src/cli.ts");
async function run(args: string[], env: Record<string, string> = {}) {
  const process = Bun.spawn([Bun.which("bun")!, cli, ...args], {
    cwd: base,
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, code };
}

test("native offline help/version/no-arg contract, contextual help values and clean streams", async () => {
  for (const args of [
    [],
    ["--help"],
    ["-h"],
    ["help", "collect"],
    ["collect", "--help"],
    ["--version"],
  ]) {
    const r = await run(args);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.length).toBeGreaterThan(0);
  }
  const value = await run([
    "--archive",
    join(base, "help-value-must-not-create"),
    "inspect",
    "--",
    "--help",
  ]);
  expect(value.code).not.toBe(0);
  expect(value.stdout).toBe("");
  expect(value.stderr).toContain("asset");
});

test("native invalid options, required selection, numeric boundaries fail before archive creation", async () => {
  const dir = await mkdtemp(join(base, "cli-")),
    archive = join(dir, "absent");
  for (const args of [
    ["collect", "8c6z-qnmj"],
    ["collect", "bad", "--max-rows", "2"],
    ["collect", "8c6z-qnmj", "--max-rows", "0"],
    ["collect", "8c6z-qnmj", "--max-rows", "2junk"],
    ["collect", "8c6z-qnmj", "--max-rows", "2", "--resume", "--refresh"],
    ["wat"],
    ["collect", "--unknown"],
    ["collect", "--max-ro", "2"],
  ]) {
    const r = await run(["--archive", archive, ...args]);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("socrata-consume");
  }
  await expect(access(archive)).rejects.toThrow();
});

test("status/verify machine results remain offline and do not create missing archives", async () => {
  const dir = await mkdtemp(join(base, "cli-status-")),
    archive = join(dir, "absent");
  const s = await run(["status", "--archive=" + archive, "--json"]);
  expect(s.code).toBe(0);
  expect(JSON.parse(s.stdout)).toMatchObject({ snapshots: 0, httpRequests: 0 });
  expect(s.stderr).toBe("");
  await expect(access(archive)).rejects.toThrow();
});
