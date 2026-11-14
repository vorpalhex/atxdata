import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { cityPdf } from "./austin-fixtures";
import { createHash } from "node:crypto";

import { state } from "./integrity-state";
test("native current aggregate cache budget is operation wide and fails before writer", async () => {
  const base = await mkdtemp(join(process.env.TMPDIR!, "integrity-budget-"));
  const root = join(base, "archive"),
    page = "https://www.austintexas.gov/budget-excellence/data-and-insights";
  const pdf = cityPdf();
  const cli = join(import.meta.dir, "../src/cli.ts");
  const invoke = async (args: string[], ok = true) => {
    const child = Bun.spawn([process.execPath, cli, ...args, "--root", root], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit).toBe(ok ? 0 : 1);
    if (!ok) expect(err).toMatch(/aggregate.*budget/);
    return out;
  };
  const html = join(base, "seed.html"),
    file = join(base, "seed.pdf");
  await writeFile(
    html,
    `<h1>City of Austin</h1><h2>FY 2031</h2><a href="https://services.austintexas.gov/edims/document.cfm?id=123456">Quarterly Financial Report</a><a href="https://services.austintexas.gov/edims/document.cfm?id=123457">Quarterly Financial Report</a>`,
  );
  await writeFile(file, pdf);
  await invoke([
    "import-page",
    "--source",
    "austin-financial-publications",
    "--page",
    page,
    "--input",
    html,
    "--origin",
    "authored",
  ]);
  const rows = JSON.parse(
    await invoke([
      "list",
      "--source",
      "austin-financial-publications",
      "--limit",
      "2",
    ]),
  );
  for (const row of rows)
    await invoke([
      "import-pdf",
      "--observation",
      row.id,
      "--input",
      file,
      "--origin",
      "authored",
    ]);
  for (const [limit, budget, ok] of [
    [1, 1, false],
    [1, pdf.length, true],
    [2, pdf.length, false],
    [2, 2 * pdf.length, true],
  ] as const) {
    const before = await state(root);
    await invoke(
      [
        "collect",
        "--source",
        "austin-financial-publications",
        "--limit",
        String(limit),
        "--max-bytes",
        String(budget),
        "--allow-network",
      ],
      ok,
    );
    expect(await state(root)).toEqual(before);
  }
});
