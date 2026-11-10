import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
import { largeZip } from "./generic-zip.test";
test("current ZIP expansion and member ceilings constrain cached native reuse", async () => {
  const bytes = await largeZip(),
    id = "f".repeat(32),
    group = "b".repeat(32);
  const item = {
    id,
    title: "Authored boundaries",
    name: "Other_Boundaries.zip",
    type: "Shapefile",
    access: "public",
    created: 1,
    modified: 2,
    size: bytes.length,
    licenseInfo: "Synthetic only",
  };
  let now = 0,
    calls = 0;
  const deps = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    fetch: async (url: string) => {
      calls++;
      const u = new URL(url);
      if (u.pathname.endsWith("robots.txt"))
        return new Response("User-agent: *\n");
      if (u.pathname.endsWith("/search"))
        return Response.json({ total: 1, nextStart: -1, results: [item] });
      if (u.pathname.endsWith(configs.austin.site + "/data"))
        return Response.json({
          catalogV2: {
            scopes: {
              item: { filters: [{ predicates: [{ group: [group] }] }] },
            },
          },
        });
      if (u.pathname.endsWith(configs.austin.site))
        return Response.json({
          id: configs.austin.site,
          title: "Hub",
          access: "public",
        });
      if (u.pathname.endsWith(id + "/data")) return new Response(bytes);
      return Response.json(item);
    },
  };
  const root = await mkdtemp(join(process.env.TMPDIR!, "zip-caller-bound-"));
  const args = [
    "collect",
    "--archive",
    root,
    "--source",
    "austin",
    "--item",
    id,
    "--terms-sha256",
    terms(item).sha256,
  ];
  const initial: any = await main(args, deps);
  expect(initial.summary.members.length).toBe(7);
  const before = calls;
  for (const flag of ["--expanded-bytes", "--max-members"]) {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../src/cli.ts"),
        ...args,
        flag,
        "1",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/ZIP expansion ceiling|ZIP member count/);
  }
  expect(((await main(args, deps)) as any).reused).toBe(true);
  expect(calls).toBe(before);
});
