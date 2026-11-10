import { main } from "../src/cli";
import { test, expect } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
test("headless CLI validates explicit scope and status/verify never access HTTP", async () => {
  const root = await mkdtemp(
    join(await realpath(process.env.TMPDIR!), "clarity-cli-"),
  );
  const run = async (...args: string[]) => {
    const p = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: await p.exited,
      out: await new Response(p.stdout).text(),
      err: await new Response(p.stderr).text(),
    };
  };
  try {
    expect(await main(["verify", "--archive", root])).toMatchObject({
      httpRequests: 0,
    });
    expect(await main(["status", "--archive", root])).toMatchObject({
      observations: 0,
    });
    await expect(main(["collect", "--archive", root])).rejects.toThrow();
    await expect(
      main(["status", "--archive", root, "--refresh"]),
    ).rejects.toThrow();
    await expect(main(["bad", "--archive", root])).rejects.toThrow();
    expect((await run("collect", "--archive", root)).code).toBe(1);
    expect(
      (await run("collect", "--archive", root, "--election", "127492/..")).code,
    ).toBe(1);
    const status = await run("status", "--archive", root);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.out).observations).toBe(0);
    const verify = await run("verify", "--archive", root);
    expect(verify.code).toBe(0);
    expect(JSON.parse(verify.out).httpRequests).toBe(0);
    expect(
      (await run("status", "--archive", root, "--unknown", "1")).code,
    ).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
