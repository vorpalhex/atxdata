import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../src/cli";
import { sources } from "../src/adapters";
import { fixturePdf } from "./engine.test";

test("positive CLI import/collect rerun verifies downloaded selection without a request", async () => {
  const root = await realpath(
    await mkdtemp(join(process.env.TMPDIR!, "cli-collect-")),
  );
  try {
    const html = join(root, "fixture.html"),
      pdf = join(root, "fixture.pdf");
    await writeFile(html, '<a href="/2.pdf">Chapter 2</a>');
    await writeFile(pdf, fixturePdf());
    await run([
      "import-page",
      "--root",
      root,
      "--source",
      "county-code",
      "--page",
      sources["county-code"].pages[0],
      "--input",
      html,
      "--origin",
      "fixture",
    ]);
    const rows = (await run([
      "list",
      "--root",
      root,
      "--source",
      "county-code",
      "--chapter",
      "2",
      "--limit",
      "1",
    ])) as { id: string }[];
    await run([
      "import-pdf",
      "--root",
      root,
      "--observation",
      rows[0]!.id,
      "--input",
      pdf,
      "--origin",
      "fixture",
    ]);
    expect(
      await run([
        "collect",
        "--root",
        root,
        "--source",
        "county-code",
        "--chapter",
        "2",
        "--limit",
        "1",
        "--allow-network",
      ]),
    ).toEqual([{ documents: 1, versions: 1, httpRequests: 0 }]);
    expect(await run(["status", "--root", root])).toMatchObject({
      attempts: 0,
    });
    await expect(
      run([
        "sync",
        "--root",
        root,
        "--source",
        "county-code",
        "--chapter",
        "999",
        "--limit",
        "1",
        "--allow-network",
      ]),
    ).rejects.toThrow("no selected");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
