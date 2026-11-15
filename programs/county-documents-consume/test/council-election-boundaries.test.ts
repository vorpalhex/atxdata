import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { Engine, sha } from "../src/engine";
import { Transport } from "../src/transport";
import { sourceName, discover } from "../src/adapters";
import { admitLive } from "../src/live-admission";
import { redirectTarget } from "../src/redirects";
import { requirePageReview } from "../src/pdf";
import { cityPdf } from "./austin-fixtures";
const page = "https://www.austintexas.gov/clerk/programs/elections",
  source = "austin-election-publications",
  doc = "https://services.austintexas.gov/edims/document.cfm?id=123456";
const html = `<article><h1>Elections</h1><a href="${doc}">City of Austin General Election Notice for January 2, 2030</a></article>`;
test("new City source redirect preserves indexed year instead of cross-year substitution", () => {
  expect(() =>
    redirectTarget(
      "austin-council-archives",
      "https://www.austintexas.gov/council/archive/2030_council_index",
      302,
      "https://www.austintexas.gov/content/archive-council-meetings-held-2031",
      "page",
    ),
  ).toThrow(/year/);
});
test("City metadata downgrade refuses native collect before sentinel writer lock and review before artifacts", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "city-admission-")),
    engine = await Engine.open(root);
  await engine.importPage(source, page, html, "authored");
  const row = engine.list(source, { limit: 1 })[0]!;
  engine.db.exec("UPDATE snapshot_metadata SET adapter_schema=3");
  await engine.close();
  await writeFile(join(root, ".civicclerk.lock"), "sentinel");
  const before = sha(await readFile(join(root, "documents.sqlite")));
  await expect(
    admitLive(root, "collect", source, { limit: 1 }),
  ).rejects.toThrow(/metadata6/);
  const p = Bun.spawnSync(
    [
      process.execPath,
      join(import.meta.dir, "../src/cli.ts"),
      "collect",
      "--root",
      root,
      "--source",
      source,
      "--limit",
      "1",
      "--allow-network",
    ],
    { env: process.env },
  );
  expect(p.exitCode).toBe(1);
  expect(p.stderr.toString()).toContain("metadata6");
  expect(sha(await readFile(join(root, "documents.sqlite")))).toBe(before);
  expect(() =>
    requirePageReview({} as any, row, Buffer.alloc(0), [], 1),
  ).toThrow(/City/);
});
test("new City public engine collect shares transport, budgets, cache verification and corrupt original rejection", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "city-library-")),
    engine = await Engine.open(root),
    pdf = cityPdf("City of Austin General Election Notice January 2, 2030");
  let clock = Date.now(),
    calls = 0;
  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetch: async (url: string) => {
      calls++;
      return new Response(
        url.endsWith("/robots.txt") ? "User-agent: *\nAllow: /\n" : pdf,
        {
          headers: {
            "content-type": url.endsWith("/robots.txt")
              ? "text/plain"
              : "application/pdf",
          },
        },
      );
    },
  };
  try {
    await engine.importPage(source, page, html, "authored");
    const row = engine.list(source, { limit: 1 })[0]!;
    const limited = new Transport(engine, deps, { maxRequests: 1 });
    await limited.collect(row.id);
    await expect(limited.collect(row.id)).rejects.toThrow(/budget/);
    expect(calls).toBe(1);
    await new Transport(engine, deps).collect(row.id);
    await engine.verify(source, { limit: 1 });
    expect(calls).toBe(2);
    const bytes = engine.db.query<any, []>("SELECT path FROM versions").get();
    await writeFile(join(root, bytes.path), "corrupt");
    await expect(engine.verify(source, { limit: 1 })).rejects.toThrow(
      /hash|checksum|checkpoint identity/,
    );
    expect(calls).toBe(2);
  } finally {
    await engine.close();
  }
});
test("City discovery rejects template/sidebar publications and invalid date before text validation", () => {
  const rows = discover(
    sourceName(source),
    page,
    `<aside><a href="${doc}">City of Austin Election Notice January 2, 2030</a></aside><article><h1>Elections</h1><a href="${doc.replace("123456", "654321")}">City of Austin Election Notice February 30, 2030</a></article>`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.date).toBeNull();
});

test("City bounded traversal selects actual source-linked year and date year without guessed endpoints", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "city-year-")),
    engine = await Engine.open(root);
  let clock = Date.now();
  const calls: string[] = [];
  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetch: async (url: string) => {
      calls.push(url);
      if (url.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /\n", {
          headers: { "content-type": "text/plain" },
        });
      return new Response(
        url === page
          ? '<article><a href="/clerk/november-2031-election">2031 Election</a><a href="/clerk/november-2032-election">2032 Election</a></article>'
          : "<article><h1>Election publications</h1></article>",
        { headers: { "content-type": "text/html" } },
      );
    },
  };
  try {
    const result = await new Transport(engine, deps).discoverTree(
      source,
      page,
      { date: "2032-11-02" },
    );
    expect(result.complete).toBe(true);
    expect(calls).toContain(
      "https://www.austintexas.gov/clerk/november-2032-election",
    );
    expect(calls.some((x) => x.includes("2031"))).toBe(false);
    const n = calls.length;
    await expect(
      new Transport(engine, deps).discoverTree(source, page, {
        year: "2031",
        date: "2032-11-02",
      }),
    ).rejects.toThrow(/year/);
    expect(calls).toHaveLength(n);
  } finally {
    await engine.close();
  }
});
test("retained Council actual302 canonical body preserves two literal blocked HTTP originals", async () => {
  const { readFileSync } = await import("node:fs");
  const inputs = JSON.parse(
      readFileSync(process.env.CITY_SOURCE_INPUTS!, "utf8"),
    ),
    find = (label: string) => inputs.find((r: any) => r.label === label),
    source = "austin-council-archives",
    root = await mkdtemp(join(process.env.TMPDIR!, "city-actual-")),
    engine = await Engine.open(root);
  let clock = Date.now();
  const first = find("council-root"),
    old = find("council-1869"),
    canonical = find("council-1869-canonical"),
    policy = find("city-robots");
  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetch: async (url: string) => {
      if (url.endsWith("/robots.txt"))
        return new Response(readFileSync(policy.path), {
          headers: { "content-type": "text/plain" },
        });
      if (url === old.url)
        return new Response(readFileSync(old.path), {
          status: 302,
          headers: { location: canonical.url, "content-type": "text/html" },
        });
      expect(url).toBe(canonical.url);
      return new Response(readFileSync(canonical.path), {
        headers: { "content-type": "text/html" },
      });
    },
  };
  try {
    await engine.importPage(
      source,
      first.url,
      readFileSync(first.path, "utf8"),
      "retained-original",
    );
    await new Transport(engine, deps).discover(source, old.url);
    const catalog = await engine.discoveryCatalog(source),
      year = catalog.find((x) => x.page === canonical.url)!;
    expect(
      year.blockedLinks.filter((x) =>
        x.href.startsWith("http://www.austintexas.gov/edims/document.cfm"),
      ),
    ).toHaveLength(2);
    expect(engine.list(source, { limit: 2000 })).toEqual([]);
    expect(
      engine.db.query<any, []>("SELECT COUNT(*) n FROM redirect_edges").get().n,
    ).toBe(1);
    await engine.preflight();
  } finally {
    await engine.close();
  }
});
