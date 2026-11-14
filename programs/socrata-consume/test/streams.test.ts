import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");
test("slow native checked delivery distinguishes EBADF, EPIPE and a non-draining pipe", async () => {
  const root = await mkdtemp(join(base, "streams-"));
  const child = Bun.spawn(
    [
      "python3",
      resolve(import.meta.dir, "support/streams.py"),
      process.execPath,
      resolve(import.meta.dir, "../src/cli.ts"),
      root,
    ],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({
    readonly: { exit: 1 },
    epipe: { exit: 0 },
    blocked: { exit: 1, bounded: true },
  });
}, 15000);
