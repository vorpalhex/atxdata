import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../src/cli";
const entry = new URL("../src/cli.ts", import.meta.url).pathname;
test("render failure is not caught as a domain failure and retried on stdout", () => {
  let writes = 0;
  expect(() =>
    runCli(
      ["--help"],
      () => {
        writes++;
        throw new Error("authored output failure");
      },
      () => {},
    ),
  ).toThrow("authored output failure");
  expect(writes).toBe(1);
});
test("native stdout failure fails safely", () => {
  const fs = require("node:fs"),
    fd = fs.openSync(entry, "r");
  try {
    const p = Bun.spawnSync([process.execPath, entry, "--help"], {
      stdout: fd,
      stderr: "pipe",
    });
    expect(p.exitCode).toBe(1);
    expect(p.stderr.toString()).toContain("output");
    expect(p.stderr.toString()).not.toContain(entry);
  } finally {
    fs.closeSync(fd);
  }
});
test("public offline information covers importer and source command help", async () => {
  const cwd = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, "frontend-"));
  try {
    for (const args of [
      ["--help"],
      ["-h"],
      ["--version"],
      ...[
        "import",
        "status",
        "verify",
        "discover",
        "collect",
        "acquire",
        "sync",
        "verify-source",
      ].flatMap((c) => [
        [c, "--help"],
        [c, "-h"],
        [c, "--version"],
        ["help", c],
      ]),
    ]) {
      const p = Bun.spawn(
        [
          process.execPath,
          entry,
          ...args,
          "--output=/not-usable",
          "--source-archive=/not-usable",
        ],
        { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
      );
      const [out, err, code] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
        p.exited,
      ]);
      expect(code).toBe(0);
      expect(err).toBe("");
      expect(out).toContain(
        args.at(-1) === "--version"
          ? "financial-transparency-consume 0.1.0"
          : "Usage:",
      );
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test("source globals route at native entrypoint, verified reuse remains zero HTTP", async () => {
  const root = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, "route-")),
    source = join(root, "source"),
    output = join(root, "import"),
    preload = join(root, "fixture.ts");
  for (const d of [source, output]) mkdirSync(d, { mode: 0o700 });
  const csv =
    "Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate\n2032,2026-10-01,0001,Authored,0002,1.01,,A,001,Example,002,fixture,\n";
  writeFileSync(
    preload,
    `import {spyOn} from 'bun:test'; const csv=${JSON.stringify(csv)}; const transport=async(url:any,init:any={})=>{if(process.env.NO_FIXTURE_HTTP)throw new Error('unexpected fixture HTTP');const u=String(url);if(u.endsWith('robots.txt'))return new Response('',{status:404});if(u.endsWith('PaymentRegister_2032.csv'))return init.method==='HEAD'?new Response(null,{headers:{'content-length':String(csv.length)}}):new Response(csv);return new Response(null,{status:404});};spyOn(Bun,'fetch').mockImplementation(transport as any);globalThis.fetch=transport as any;`,
  );
  const run = async (args: string[], reuse = false) => {
    const p = Bun.spawn(
      [process.execPath, "--preload", preload, entry, ...args],
      {
        cwd: root,
        env: { ...process.env, ...(reuse ? { NO_FIXTURE_HTTP: "1" } : {}) },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    expect(err).toBe("");
    expect(code).toBe(0);
    return JSON.parse(out);
  };
  try {
    const after = await run([
      "discover",
      "--source-archive",
      source,
      "--fiscal-year=2032",
    ]);
    const before = await run(
      ["--source-archive=" + source, "discover", "--fiscal-year", "2032"],
      true,
    );
    expect({ ...before, reused: false }).toEqual(after);
    expect(before.reused).toBe(true);
    expect(
      (
        await run([
          "--source-archive",
          source,
          "collect",
          "--output",
          output,
          "--fiscal-year=2032",
        ])
      ).accepted,
    ).toBe(1);
    for (const command of ["collect", "acquire", "sync"]) {
      expect(
        (
          await run(
            [
              command,
              "--source-archive",
              source,
              "--output",
              output,
              "--fiscal-year=2032",
            ],
            true,
          )
        ).reused,
      ).toBe(true);
      expect(
        (
          await run(
            [
              "--source-archive",
              source,
              command,
              "--output",
              output,
              "--fiscal-year=2032",
            ],
            true,
          )
        ).reused,
      ).toBe(true);
    }
    for (const args of [
      ["verify-source", "--source-archive", source, "--output", output],
      ["--source-archive", source, "verify-source", "--output", output],
    ])
      expect((await run(args, true)).httpRequests).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
test("published failure stays stdout and gains safe actionable stderr", () => {
  const p = Bun.spawnSync([process.execPath, entry, "import", "--file"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(p.exitCode).toBe(1);
  expect(p.stdout.toString()).toBe('{"error":"operation_failed"}\n');
  expect(p.stderr.toString()).toContain("--help");
  expect(p.stderr.toString()).not.toContain("Error:");
});
