import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
test("CLI labels unsupported source content without exposing body and caches failure", async () => {
  const { runAcquisitionCli } = await import("../src/acquisition-cli");
  const root = mkdtempSync(
    join(process.env.FINANCIAL_TEST_ROOT!, "unsupported-"),
  );
  const source = join(root, "source"),
    output = join(root, "import");
  for (const dir of [source, output]) mkdirSync(dir, { mode: 0o700 });
  let time = Date.now(),
    calls = 0;
  const lines: string[] = [];
  const dependencies = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async (url: string) => {
      calls++;
      return url.endsWith("robots.txt")
        ? new Response("", { status: 404 })
        : new Response("<html>sensitive challenge</html>");
    },
  };
  try {
    const args = [
      "collect",
      "--source-archive",
      source,
      "--output",
      output,
      "--fiscal-year",
      "1988",
    ];
    expect(
      await runAcquisitionCli(args, (s) => lines.push(s), dependencies),
    ).toBe(4);
    expect(
      await runAcquisitionCli(args, (s) => lines.push(s), dependencies),
    ).toBe(4);
    expect(lines).toEqual([
      '{"status":"unsupported"}',
      '{"status":"unsupported"}',
    ]);
    expect(calls).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("CLI exposes positive finite budgets, arbitrary selection and privacy-safe results", async () => {
  const module = (await import("../src/acquisition-cli").catch(
    () => ({}),
  )) as any;
  expect(typeof module.runAcquisitionCli).toBe("function");
  const root = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, "cli-"));
  const sourceArchive = join(root, "source"),
    output = join(root, "import");
  for (const dir of [sourceArchive, output]) mkdirSync(dir, { mode: 0o700 });
  let calls = 0,
    time = Date.now();
  const lines: string[] = [];
  const csv =
    "Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate\n2032,2026-10-01,0001,Authored,0002,1.01,,A,001,Example,002,fixture,\n";
  const deps = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async (url: string) => {
      calls++;
      return url.endsWith("robots.txt")
        ? new Response("", { status: 404 })
        : new Response(csv);
    },
  };
  const base = [
    "collect",
    "--source-archive",
    sourceArchive,
    "--output",
    output,
    "--fiscal-year",
    "2032",
  ];
  try {
    for (const value of [
      "0",
      "-1",
      "1.5",
      "Infinity",
      "01",
      "9007199254740992",
    ]) {
      expect(
        await module.runAcquisitionCli(
          [...base, "--max-requests", value],
          (s: string) => lines.push(s),
          deps,
        ),
      ).toBe(1);
      expect(calls).toBe(0);
    }
    expect(
      await module.runAcquisitionCli(
        [
          ...base,
          "--max-requests",
          "2",
          "--max-bytes",
          "40000000",
          "--max-total-bytes",
          "41000000",
          "--max-rows",
          "500000",
        ],
        (s: string) => lines.push(s),
        deps,
      ),
    ).toBe(0);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      fiscalYear: 2032,
      status: "imported",
      accepted: 1,
    });
    expect(lines.join("")).not.toContain(output);
    expect(lines.join("")).not.toContain("Authored");
    expect(
      await module.runAcquisitionCli(
        [
          "verify-source",
          "--source-archive",
          sourceArchive,
          "--output",
          output,
        ],
        (s: string) => lines.push(s),
      ),
    ).toBe(0);
    expect(calls).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
