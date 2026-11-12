import {
  cityDiscoveryScopeYear,
  cityDiscoveryLinkSelected,
} from "../src/city-discovery-scope";
import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Engine } from "../src/engine";
import { Transport } from "../src/transport";
import { sourceName } from "../src/adapters";
const profiles = [
  {
    source: "austin-council-archives",
    root: "https://www.austintexas.gov/council/archive/city_council_meeting_archives",
    route: (year: string) =>
      `https://www.austintexas.gov/council/archive/${year}_council_index`,
  },
  {
    source: "austin-election-publications",
    root: "https://www.austintexas.gov/clerk/programs/elections",
    route: (year: string) =>
      `https://www.austintexas.gov/clerk/november-${year}-election`,
  },
] as const;
async function native(
  root: string,
  source: string,
  page: string,
  options: string[],
  preload?: string,
) {
  const p = Bun.spawn(
    [
      process.execPath,
      ...(preload ? ["--preload", preload] : []),
      join(import.meta.dir, "../src/cli.ts"),
      "discover",
      "--root",
      root,
      "--source",
      source,
      "--page",
      page,
      "--allow-network",
      ...options,
    ],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, exit] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out, err, exit };
}
for (const profile of profiles)
  for (const scope of [
    ["--year", "2030"],
    ["--date", "2030-01-02"],
  ])
    test(`F1 native ${profile.source} ${scope[0]} preserves contradictory catalog links without requesting them`, async () => {
      const base = await mkdtemp(
          join(process.env.TMPDIR!, "city-scope-native-"),
        ),
        archive = join(base, "archive"),
        calls: string[] = [];
      const index = `<article><h1>City publications</h1><a href="${profile.route("2030")}">2030 publications</a><a href="${profile.route("2031")}">2030 publications</a><a href="${profile.route("2032")}">2030 / 2032 publications</a></article>`;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
          const url = req.headers.get("x-authored-url")!;
          calls.push(url);
          if (url.endsWith("/robots.txt"))
            return new Response("User-agent: *\nAllow: /\n", {
              headers: { "content-type": "text/plain" },
            });
          return new Response(
            url === profile.root
              ? index
              : "<article>City publications</article>",
            { headers: { "content-type": "text/html" } },
          );
        },
      });
      const preload = join(base, "preload.ts"),
        encoding = join(import.meta.dir, "../src/encoding.ts");
      await writeFile(
        preload,
        `import {mock} from 'bun:test';const p=${JSON.stringify(encoding)},m={...await import(p)};mock.module(p,()=>({...m,rawFetch:(url,init={})=>{const headers=new Headers(init.headers);headers.set('x-authored-url',url);return m.rawFetch(${JSON.stringify(server.url.href)},{...init,headers});}}));`,
      );
      try {
        const result = await native(
          archive,
          profile.source,
          profile.root,
          [...scope, "--max-pages", "4"],
          preload,
        );
        expect(result.exit, result.err).toBe(0);
        expect(calls).toContain(profile.route("2030"));
        expect(calls).not.toContain(profile.route("2031"));
        expect(calls).not.toContain(profile.route("2032"));
        const e = await Engine.open(archive);
        try {
          const catalog = await e.discoveryCatalog(sourceName(profile.source));
          expect(
            catalog[0]!.pages.some(
              (link) =>
                link.url === profile.route("2031") &&
                link.label === "2030 publications",
            ),
          ).toBe(true);
          expect(
            e.db
              .query<{ url: string }, []>("SELECT url FROM snapshots")
              .all()
              .some((r) => r.url === profile.route("2031")),
          ).toBe(false);
        } finally {
          await e.close();
        }
      } finally {
        server.stop(true);
      }
    }, 45000);
for (const profile of profiles)
  test(`F1/F2 native ${profile.source} malformed scope and mismatched initial page refuse before absent root or writer`, async () => {
    const base = await mkdtemp(
        join(process.env.TMPDIR!, "city-scope-prewriter-"),
      ),
      preload = join(base, "deny.ts"),
      log = join(base, "fetch.log");
    await writeFile(log, "");
    await writeFile(
      preload,
      `import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(log)},'fetch');throw Error('unexpected HTTP');};`,
    );
    const cases: [string, string[]][] = [
      [profile.root, ["--year", "2031", "--date", "2032-01-02"]],
      [profile.root, ["--year", "203x"]],
      [profile.root, ["--year", ""]],
      [profile.root, ["--date", "2032"]],
      [profile.root, ["--date", "2032-02-30"]],
      [profile.root, ["--date", ""]],
      [profile.route("2031"), ["--year", "2030"]],
      [profile.route("2031"), ["--date", "2030-01-02"]],
    ];
    for (const [i, [page, scope]] of cases.entries()) {
      const fresh = join(base, "absent-" + i),
        result = await native(fresh, profile.source, page, scope, preload);
      expect(result.exit).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toMatch(
        /City discovery (?:year|date)|initial City discovery page year|missing --(?:year|date) value/,
      );
      expect(await readdir(base)).not.toContain("absent-" + i);
      const fence = join(base, "fence-" + i);
      await (await import("node:fs/promises")).mkdir(fence);
      await writeFile(join(fence, ".civicclerk.lock"), "sentinel");
      const fenced = await native(fence, profile.source, page, scope, preload);
      expect(fenced.exit).toBe(1);
      expect(fenced.err).toMatch(
        /City discovery (?:year|date)|initial City discovery page year|missing --(?:year|date) value/,
      );
      expect(fenced.err).not.toContain("EEXIST");
      expect(await readdir(fence)).toEqual([".civicclerk.lock"]);
      expect(await readFile(join(fence, ".civicclerk.lock"), "utf8")).toBe(
        "sentinel",
      );
    }
    for (const flag of ["--help", "--version"]) {
      const fresh = join(base, "info-" + flag.slice(2)),
        result = await native(
          fresh,
          profile.source,
          profile.route("2031"),
          ["--year", "2030", "--date", "invalid", flag],
          preload,
        );
      expect(result.exit).toBe(0);
      expect(result.err).toBe("");
      expect(result.out).toContain("county-documents-consume");
      expect(await readdir(base)).not.toContain("info-" + flag.slice(2));
    }
    expect(await readFile(log, "utf8")).toBe("");
  });
for (const profile of profiles)
  test(`F1/F2 direct library ${profile.source} rejects initial mismatch and conflicting scope before HTTP`, async () => {
    const root = await mkdtemp(
        join(process.env.TMPDIR!, "city-scope-library-"),
      ),
      engine = await Engine.open(root);
    let calls = 0;
    const deps = {
      fetch: async () => {
        calls++;
        throw Error("unexpected HTTP");
      },
    };
    try {
      await expect(
        new Transport(engine, deps).discoverTree(
          sourceName(profile.source),
          profile.route("2031"),
          { year: "2030" },
        ),
      ).rejects.toThrow(/initial City discovery page year/);
      await expect(
        new Transport(engine, deps).discoverTree(
          sourceName(profile.source),
          profile.root,
          { year: "2031", date: "2032-01-02" },
        ),
      ).rejects.toThrow(/City discovery year/);
      expect(calls).toBe(0);
      expect(
        engine.db
          .query<{ n: number }, []>("SELECT COUNT(*) n FROM attempts")
          .get()!.n,
      ).toBe(0);
    } finally {
      await engine.close();
    }
  });

test("F1 scope compares all explicit label/route years without rewriting evidence", () => {
  for (const profile of profiles) {
    const link = { url: profile.route("1807"), label: "1807 publications" },
      before = { ...link };
    expect(cityDiscoveryLinkSelected(profile.source, link, "1807")).toBe(true);
    expect(link).toEqual(before);
    for (const [route, label] of [
      ["2030", "2031 publications"],
      ["2031", "2030 publications"],
      ["2030", "2030 / 2031 publications"],
    ]) {
      const link = { url: profile.route(route!), label: label! };
      expect(cityDiscoveryLinkSelected(profile.source, link, "2030")).toBe(
        false,
      );
      expect(cityDiscoveryLinkSelected(profile.source, link)).toBe(false);
    }
    const multi = profile.source.includes("council")
      ? "https://www.austintexas.gov/council/2030/2031_master_index"
      : "https://www.austintexas.gov/clerk/elections/Ballot-Applications-2030-2031";
    expect(
      cityDiscoveryLinkSelected(
        profile.source,
        { url: multi, label: "2030" },
        "2030",
      ),
    ).toBe(false);
    expect(() =>
      cityDiscoveryScopeYear(profile.source, multi, { year: "2030" }),
    ).toThrow(/initial City discovery page year/);
    expect(
      cityDiscoveryLinkSelected(
        profile.source,
        { url: profile.root, label: "City publications" },
        "2030",
      ),
    ).toBe(true);
    expect(
      cityDiscoveryScopeYear(profile.source, profile.route("2030"), {
        date: "2030-01-02",
      }),
    ).toBe("2030");
  }
});
test("F2 shared pure boundary retains direct-library validation and unchanged non-City scope", () => {
  for (const profile of profiles) {
    for (const scope of [
      { year: "" },
      { date: "" },
      { date: "2030-2-01" },
      { date: "2030-02-30" },
      { date: "2030-13-01" },
      { year: "bad" },
    ])
      expect(() =>
        cityDiscoveryScopeYear(profile.source, profile.root, scope),
      ).toThrow(/City discovery/);
  }
  expect(
    cityDiscoveryScopeYear(
      "budgets",
      "https://www.traviscountytx.gov/planning-budget",
      { year: "unchanged", date: "invalid" },
    ),
  ).toBe("unchanged");
  expect(
    cityDiscoveryLinkSelected(
      "budgets",
      {
        url: "https://www.traviscountytx.gov/planning-budget/2031",
        label: "2030",
      },
      "2030",
    ),
  ).toBe(true);
});
