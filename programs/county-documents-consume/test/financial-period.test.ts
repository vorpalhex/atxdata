import { test, expect } from "bun:test";
import {
  readFileSync,
  readdirSync,
  statSync,
  cpSync,
  mkdtempSync,
} from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { discover } from "../src/adapters";
import { requireTextIdentity } from "../src/pdf";
import { Engine } from "../src/engine";
import { admitLive } from "../src/live-admission";
import { cityPdf } from "./austin-fixtures";
import { Transport } from "../src/transport";
const source = "austin-financial-publications",
  page = "https://www.austintexas.gov/budget-excellence/data-and-insights";
const url = "https://services.austintexas.gov/edims/document.cfm?id=471059";
function row(label: string, heading = "") {
  return discover(
    source,
    page,
    `<h2>${heading}</h2><a href="${url}">${label}</a>`,
  )[0]!;
}
const spanLabel = "Fiscal Year 2025-2026, 1st Quarter Financial Report";
test("current explicit span retains endpoints, literal quarter and nullable canonical scalars", () => {
  const r = row(spanLabel);
  expect(r).toMatchObject({
    year: null,
    fiscalYear: null,
    fiscalPeriod: {
      kind: "span",
      original: "Fiscal Year 2025-2026",
      origin: { kind: "label" },
      startYear: "2025",
      endYear: "2026",
    },
    quarter: { original: "1st Quarter", ordinal: 1, origin: { kind: "label" } },
  });
});
test("retained actual HTML reproduces full explicit period without first-year collapse", () => {
  const path = process.env.FINANCIAL_PERIOD_INPUT;
  if (!path)
    throw Error(
      "FINANCIAL_PERIOD_INPUT required for retained-original regression",
    );
  const input = JSON.parse(readFileSync(path, "utf8"));
  const rows = input.originals.flatMap((x: any) =>
    discover(source, x.url, readFileSync(x.exactOriginalPath, "utf8")),
  );
  for (const x of input.currentEvidence) {
    const r = rows.find((r: any) => r.url === x.url)!;
    expect(r.label).toBe(x.label);
    expect(r.fiscalYear).toBeNull();
    expect(r.fiscalPeriod).toMatchObject({
      kind: "span",
      startYear: "2025",
      endYear: "2026",
    });
  }
});
test("single year, heading provenance, written and Q ordinals remain explicit", () => {
  expect(row("Second Quarter Financial Report", "FY 2025")).toMatchObject({
    year: "2025",
    fiscalYear: "2025",
    fiscalPeriod: {
      kind: "single-year",
      year: "2025",
      origin: { kind: "heading", index: 0 },
    },
    quarter: { ordinal: 2, original: "Second Quarter" },
  });
  expect(row("FY 2025 Q3 Financial Report").quarter?.ordinal).toBe(3);
  expect(row("FY 2025 Fourth Quarter Financial Report").quarter?.ordinal).toBe(
    4,
  );
});
test("ambiguous, incomplete, reversed or conflicting tokens never certify identity", () => {
  for (const label of [
    "FY 2025-26 Q1 Financial Report",
    "FY 2025- Q1 Financial Report",
    "FY 2026-2025 Q1 Financial Report",
    "FY 2025 Q1 Financial Report FY 2026",
    "Q1 Financial Report",
  ]) {
    const r = row(label);
    expect(r.fiscalPeriod).toBeNull();
    expect(() =>
      requireTextIdentity(
        "City of Austin Quarterly Financial Report FY 2025 Q1",
        r,
      ),
    ).toThrow(/identity/);
  }
  expect(row(spanLabel, "FY 2024").fiscalPeriod).toBeNull();
  expect(row("FY 2025 Q1 Q2 Financial Report").quarter).toBeNull();
});
test("new body identity binds both endpoints and explicit quarter, publisher and role", () => {
  const r = row(spanLabel);
  expect(() =>
    requireTextIdentity(
      "City of Austin Quarterly Financial Report Fiscal Year 2025-2026 First Quarter",
      r,
    ),
  ).not.toThrow();
  for (const body of [
    "City of Austin Quarterly Financial Report FY 2025-2027 First Quarter",
    "City of Austin Quarterly Financial Report FY 2025 First Quarter",
    "City of Austin Quarterly Financial Report FY 2026 First Quarter",
    "City of Austin Quarterly Financial Report FY 2025-2026 Second Quarter",
    "City of Austin Quarterly Financial Report FY 2025-2026",
    "Travis County Quarterly Financial Report FY 2025-2026 First Quarter",
    "City of Austin Monthly Financial Report FY 2025-2026 First Quarter",
  ])
    expect(() => requireTextIdentity(body, r)).toThrow(/identity/);
});
test("authored span-quarter PDF produces identity6 receipt bound to full selection and replays offline", async () => {
  const root = mkdtempSync(join(process.env.TMPDIR!, "period-receipt-")),
    engine = await Engine.open(root);
  try {
    await engine.importPage(
      source,
      page,
      `<a href="${url}">${spanLabel}</a>`,
      "retained-original",
    );
    const r = engine.list(source, { limit: 1, url })[0]!;
    await engine.importPdf(
      r.id,
      cityPdf(
        "City of Austin Quarterly Financial Report FY 2025-2026 First Quarter",
      ),
      "application/pdf",
      "retained-original",
    );
    const receipt = JSON.parse(
      engine.db
        .query<{ validation: string }, []>("SELECT validation FROM versions")
        .get()!.validation,
    );
    expect(receipt).toMatchObject({
      schema: 6,
      identityPolicy: "austin-period-quarter-title-v2",
      body: {
        fiscalYear: null,
        fiscalPeriod: { kind: "span", startYear: "2025", endYear: "2026" },
        quarter: { ordinal: 1 },
      },
      selection: {
        source,
        url,
        publisher: "City of Austin",
        jurisdiction: "City of Austin",
        fiscalYear: null,
        fiscalPeriod: { kind: "span", startYear: "2025", endYear: "2026" },
        quarter: { ordinal: 1 },
      },
    });
    expect(await engine.verify(source, { limit: 1, url })).toMatchObject({
      documents: 1,
      httpRequests: 0,
    });
  } finally {
    await engine.close();
  }
});
test("legacy library transport refuses before any fake fetch or ledger mutation", async () => {
  const root = legacy(),
    engine = await Engine.open(root);
  let requests = 0;
  try {
    const before = engine.status();
    const t = new Transport(engine, {
      fetch: async () => {
        requests++;
        throw Error("forbidden fetch");
      },
    });
    const r = engine.list(source, { limit: 1, url })[0]!;
    await expect(t.collect(r.id)).rejects.toThrow(/metadata5/);
    expect(requests).toBe(0);
    expect(engine.status()).toEqual(before);
  } finally {
    await engine.close();
  }
});
function tree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of readdirSync(root)) {
    if (name.endsWith("-shm")) continue;
    const p = join(root, name);
    if (statSync(p).isFile())
      result[name] = Bun.hash(readFileSync(p)).toString();
  }
  return result;
}
function legacy() {
  const input = process.env.FINANCIAL_LEGACY_ROOT;
  if (!input)
    throw Error(
      "FINANCIAL_LEGACY_ROOT required; genuine old producer fixture missing",
    );
  const p = mkdtempSync(join(process.env.TMPDIR!, "period-legacy-"));
  cpSync(input, p, { recursive: true });
  return p;
}
test("genuine old producer metadata4/identity5 verifies; fresh same-SHA import appends metadata5 without rewriting legacy", async () => {
  const root = legacy(),
    engine = await Engine.open(root);
  try {
    const old = engine.db.query("SELECT * FROM snapshots").all();
    const meta = engine.db.query("SELECT * FROM snapshot_metadata").all();
    expect(meta).toMatchObject([{ adapter_schema: 4 }]);
    expect(await engine.verify(source, { limit: 1, url })).toMatchObject({
      documents: 1,
      httpRequests: 0,
    });
    const original = engine.db
      .query<{ evidence: string }, []>(
        "SELECT evidence FROM observations ORDER BY rowid",
      )
      .all();
    await engine.importPage(
      source,
      page,
      readFileSync(join(root, "producer.html"), "utf8"),
      "retained-original",
    );
    expect(
      engine.db.query("SELECT * FROM snapshots ORDER BY rowid LIMIT 1").all(),
    ).toEqual(old);
    expect(
      engine.db
        .query("SELECT * FROM snapshot_metadata ORDER BY rowid LIMIT 1")
        .all(),
    ).toEqual(meta);
    expect(
      engine.db
        .query("SELECT evidence FROM observations ORDER BY rowid LIMIT 2")
        .all(),
    ).toEqual(original);
    expect(
      engine.db
        .query(
          "SELECT adapter_schema FROM snapshot_metadata ORDER BY rowid DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ adapter_schema: 5 });
    expect(
      engine.db.query("SELECT DISTINCT sha FROM snapshots").all(),
    ).toHaveLength(1);
    await engine.preflight();
  } finally {
    await engine.close();
  }
});
test("old pending collect and sync reject before writer even with lock; all-cache collect remains admitted", async () => {
  for (const sentinel of [false, true]) {
    const root = legacy();
    const pending =
      "https://services.austintexas.gov/edims/document.cfm?id=474492";
    if (sentinel) await Bun.write(join(root, ".civicclerk.lock"), "sentinel");
    const before = tree(root);
    for (const [command, target] of [
      ["collect", pending],
      ["sync", url],
    ]) {
      await expect(
        admitLive(root, command, source, { limit: 1, url: target }),
      ).rejects.toThrow(/metadata5/);
      const child = Bun.spawnSync(
        [
          process.execPath,
          "run",
          "src/cli.ts",
          command,
          "--root",
          root,
          "--source",
          source,
          "--url",
          target!,
          "--limit",
          "1",
          "--allow-network",
        ],
        { cwd: process.cwd(), env: process.env },
      );
      expect(child.exitCode).not.toBe(0);
      expect(child.stderr.toString()).toContain("metadata5");
      expect(tree(root)).toEqual(before);
    }
    await expect(
      admitLive(root, "collect", source, { limit: 1, url }),
    ).resolves.toBeUndefined();
    expect(tree(root)).toEqual(before);
  }
});
test("legacy PDF import refuses before writer lock and preserves all durable bytes", async () => {
  const root = legacy();
  const db = new Database(join(root, "documents.sqlite"), { readonly: true });
  const id = db
    .query<{ id: string }, []>(
      "SELECT id FROM observations ORDER BY rowid LIMIT 1",
    )
    .get()!.id;
  db.close();
  const pdf = join(
    root,
    readdirSync(root).find((n) => n.endsWith(".pdf"))!,
  );
  await Bun.write(join(root, ".civicclerk.lock"), "sentinel");
  const before = tree(root);
  const child = Bun.spawnSync(
    [
      process.execPath,
      "run",
      "src/cli.ts",
      "import-pdf",
      "--root",
      root,
      "--observation",
      id,
      "--input",
      pdf,
      "--origin",
      "authored",
    ],
    { cwd: process.cwd(), env: process.env },
  );
  expect(child.exitCode).toBe(1);
  expect(child.stderr.toString()).toContain("metadata5");
  expect(tree(root)).toEqual(before);
});
test("new validation of legacy selected evidence refuses before candidate artifacts", async () => {
  const root = legacy(),
    engine = await Engine.open(root);
  try {
    const r = engine.list(source, { limit: 1, url })[0]!;
    const before = engine.status();
    await expect(
      engine.validatePdf(cityPdf(), "application/pdf", r),
    ).rejects.toThrow(/metadata5/);
    expect(engine.status()).toEqual(before);
  } finally {
    await engine.close();
  }
});
