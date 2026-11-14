import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
for (const [source, page, href, label] of [
  [
    "austin-council-archives",
    "https://www.austintexas.gov/council/archive/city_council_meeting_archives",
    "/council/archive/1870_council_index",
    "1870",
  ],
  [
    "austin-election-publications",
    "https://www.austintexas.gov/clerk/programs/elections",
    "/clerk/november-2030-election",
    "2030 General Election Information",
  ],
])
  test(`native ${source} retained page discovery and catalog`, async () => {
    const root = await mkdtemp(join(process.env.TMPDIR!, "city-catalog-")),
      input = join(root, "seed.html"),
      archive = join(root, "archive");
    await writeFile(
      input,
      `<main><h1>City of Austin</h1><a href="${href}">${label}</a></main>`,
    );
    async function invoke(args: string[]) {
      const child = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, "../src/cli.ts"),
          ...args,
          "--root",
          archive,
          "--source",
          source,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [out, err, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(err).toBe("");
      expect(exit).toBe(0);
      return JSON.parse(out);
    }
    await invoke([
      "import-page",
      "--page",
      page,
      "--input",
      input,
      "--origin",
      "authored-fixture",
    ]);
    const catalog = await invoke(["catalog"]);
    expect(JSON.stringify(catalog)).toContain(href);
    expect(await invoke(["list", "--limit", "1"])).toEqual([]);
  });
