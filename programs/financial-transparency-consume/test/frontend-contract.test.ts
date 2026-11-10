import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { runAcquisitionCli } from "../src/acquisition-cli";
import { commandOf, information } from "../src/frontend";

const header =
  "Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate\n";
test("imported importer executes healthy bytes, duplicate rejection, scope and fixed private failure", () => {
  const root = mkdtempSync(
    join(process.env.FINANCIAL_TEST_ROOT!, "qm1-import-"),
  );
  const output = join(root, "archive"),
    file = join(root, "authored.csv");
  mkdirSync(output, { mode: 0o700 });
  writeFileSync(
    file,
    header +
      "2032,2026-10-01,0001,Private Vendor,0002,1.01,,A,001,Example,002,fixture,\n",
  );
  const run = (args: string[]) => {
    const out: string[] = [],
      err: string[] = [];
    const status = runCli(
      args,
      (s) => out.push(s),
      (s) => err.push(s),
    );
    return { out, err, status };
  };
  try {
    const imported = run([
      "--output",
      output,
      "import",
      "--file=" + file,
      "--fiscal-year",
      "2032",
    ]);
    expect(imported.status).toBe(0);
    expect(imported.err).toEqual([]);
    expect(JSON.parse(imported.out[0]!)).toMatchObject({
      accepted: 1,
      rejected: 0,
      status: "imported",
      fiscalYear: 2032,
    });
    expect(imported.out.join("")).not.toContain("Private Vendor");
    for (const command of ["verify", "status"]) {
      const result = run([command, "--output=" + output]);
      expect(result.status).toBe(0);
      expect(result.err).toEqual([]);
      expect(JSON.parse(result.out[0]!)).toBeObject();
    }
    for (const args of [
      [],
      ["status", "--output", output, "--output", output],
      ["status", "--output", output, "--file", file],
      ["unknown", "--output", output],
      ["--output", output, "--", "status"],
      ["import", "--output", output, "--file", file, "--fiscal-year=01"],
    ]) {
      const result = run(args);
      expect(result.status).toBe(1);
      expect(result.out).toEqual(['{"error":"operation_failed"}']);
      expect(result.err.join("")).toContain("--help");
      expect(result.err.join("")).not.toContain(root);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("imported source parser rejects ambiguous plans before any source request", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    throw new Error("must not request");
  };
  const base = [
    "collect",
    "--source-archive",
    process.env.FINANCIAL_TEST_ROOT! + "/qm1-not-open",
    "--output",
    "private",
    "--fiscal-year",
    "2032",
  ];
  for (const args of [
    [...base, "--fiscal-year=2032"],
    [...base, "--first-year=2031"],
    [...base, "--last-year=2033"],
    [...base, "--max-rows=0"],
    ["collect", "--source-archive", "private"],
    ["--source-archive", "private", "--", "collect"],
  ]) {
    const lines: string[] = [];
    expect(await runAcquisitionCli(args, (s) => lines.push(s), { fetch })).toBe(
      1,
    );
    expect(lines).toEqual(['{"error":"operation_failed"}']);
    expect(calls).toBe(0);
  }
  for (const name of [
    "collect",
    "acquire",
    "sync",
    "discover",
    "verify-source",
  ]) {
    expect(commandOf(["--source-archive", name, "status"])).toBe("status");
    expect(
      information(["--source-archive", name, "collect", "--help"]),
    ).toContain("collect");
  }
});
