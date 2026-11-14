import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, cp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { cityPdf } from "./austin-fixtures";
import { Engine, sha } from "../src/engine";
import { Transport } from "../src/transport";
import { discover, sourceName } from "../src/adapters";
import { requireTextIdentity } from "../src/pdf";
const profiles = [
  {
    source: "austin-council-archives",
    root: "https://www.austintexas.gov/council/archive/city_council_meeting_archives",
    next: "https://www.austintexas.gov/council/archive/2030_council_index",
    final:
      "https://www.austintexas.gov/content/archive-council-meetings-held-2030",
    label: "January 2, 2030 Austin City Council Regular Meeting Minutes",
    title:
      "City of Austin City Council Regular Meeting Minutes January 2, 2030",
    role: "minutes",
  },
  {
    source: "austin-election-publications",
    root: "https://www.austintexas.gov/clerk/programs/elections",
    next: "https://www.austintexas.gov/clerk/november-2030-election",
    final: "https://www.austintexas.gov/clerk/november-2030-election",
    label: "City of Austin General Election Notice for January 2, 2030",
    title: "City of Austin General Election Notice January 2, 2030",
    role: "election-notice",
  },
] as const;
for (const profile of profiles)
  test(`native ${profile.source} discovery collect cache replay and refusal`, async () => {
    const source = sourceName(profile.source),
      root = await mkdtemp(join(process.env.TMPDIR!, "city-native-")),
      archive = join(root, "archive");
    const doc = "https://services.austintexas.gov/edims/document.cfm?id=123456",
      pdf = cityPdf(profile.title),
      calls: string[] = [];
    const index = `<article><h1>City of Austin</h1><a href="${profile.next}">2030 ${source.includes("council") ? "" : "General Election Information"}</a></article>`;
    const listing = `<article><h1>${profile.source.includes("council") ? "Archive: Council Meetings Held in 2030" : "November 2030 Election"}</h1><a href="${doc}">${profile.label}</a></article>`;
    let invalid = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = req.headers.get("x-authored-url")!;
        calls.push(url);
        expect(req.headers.get("cookie")).toBeNull();
        if (url === "https://services.austintexas.gov/robots.txt")
          return new Response("policy redirect", {
            status: 302,
            headers: {
              location: "https://www.austintexas.gov/robots.txt",
              "content-type": "text/plain",
            },
          });
        if (url === "https://www.austintexas.gov/robots.txt")
          return new Response("User-agent: *\nAllow: /\n", {
            headers: { "content-type": "text/plain" },
          });
        if (url === profile.root)
          return new Response(index, {
            headers: { "content-type": "text/html" },
          });
        if (url === profile.next && profile.next !== profile.final)
          return new Response("canonical", {
            status: 302,
            headers: { location: profile.final, "content-type": "text/html" },
          });
        if (url === profile.final)
          return new Response(listing, {
            headers: { "content-type": "text/html" },
          });
        if (url === doc)
          return new Response(
            invalid
              ? cityPdf("Travis County Election Notice January 2, 2030")
              : pdf,
            { headers: { "content-type": "application/pdf" } },
          );
        return new Response("unmapped", { status: 404 });
      },
    });
    const preload = join(root, "preload.ts"),
      encoding = join(import.meta.dir, "../src/encoding.ts");
    await writeFile(
      preload,
      `import {mock} from 'bun:test';const p=${JSON.stringify(encoding)};const m={...await import(p)};mock.module(p,()=>({...m,rawFetch:(url,init={})=>{const headers=new Headers(init.headers);headers.set('x-authored-url',url);return m.rawFetch(${JSON.stringify(server.url.href)},{...init,headers});}}));`,
    );
    async function invoke(
      command: string,
      extra: string[] = [],
      target = archive,
      expected = 0,
    ) {
      const args = [
        process.execPath,
        "--preload",
        preload,
        join(import.meta.dir, "../src/cli.ts"),
        command,
        "--root",
        target,
        "--source",
        source,
        ...extra,
      ];
      const child = Bun.spawn(args, {
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit, err).toBe(expected);
      if (expected) return err;
      expect(err).toBe("");
      return JSON.parse(out);
    }
    try {
      const found = await invoke("discover", [
        "--page",
        profile.root,
        "--year",
        "2030",
        "--max-pages",
        "2",
        "--allow-network",
      ]);
      expect(found.snapshots).toHaveLength(2);
      const rows = await invoke("list", [
        "--limit",
        "1",
        "--date",
        "2030-01-02",
        "--role",
        profile.role,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        publisher: "City of Austin",
        jurisdiction: "City of Austin",
        administeringCounty: null,
        year: "2030",
        date: "2030-01-02",
        fiscalYear: null,
        role: profile.role,
        href: doc,
      });
      await invoke("collect", ["--limit", "1", "--allow-network"]);
      const db = new Database(join(archive, "documents.sqlite"), {
        readonly: true,
      });
      expect(
        db.query("SELECT DISTINCT adapter_schema FROM snapshot_metadata").all(),
      ).toEqual([{ adapter_schema: 6 }]);
      const version = db.query<any, []>("SELECT * FROM versions").get();
      expect(version.sha).toBe(sha(pdf));
      expect(JSON.parse(version.validation)).toMatchObject({
        schema: 7,
        identityPolicy: "austin-publication-title-date-role-v1",
        selection: {
          publisher: "City of Austin",
          date: "2030-01-02",
          role: profile.role,
        },
      });
      expect(
        db.query<any, []>("SELECT COUNT(*) n FROM snapshot_producers").get().n,
      ).toBe(2);
      db.close();
      expect(sha(await readFile(join(archive, version.path)))).toBe(sha(pdf));
      const n = calls.length;
      await invoke("collect", ["--limit", "1", "--allow-network"]);
      await invoke("verify", ["--limit", "1"]);
      expect(calls.length).toBe(n);
      for (const [name, sql] of [
        ["metadata", "UPDATE snapshot_metadata SET adapter_schema=3"],
        ["producer", "DELETE FROM snapshot_producers"],
        [
          "receipt",
          "UPDATE versions SET validation=json_set(validation,'$.schema',4)",
        ],
      ]) {
        const copy = join(root, name);
        await cp(archive, copy, { recursive: true });
        const d = new Database(join(copy, "documents.sqlite"));
        d.exec(sql!);
        d.close();
        expect(await invoke("verify", ["--limit", "1"], copy, 1)).toMatch(
          /metadata|producing|receipt|validation/,
        );
        expect(calls.length).toBe(n);
      }
      invalid = true;
      expect(
        await invoke("sync", ["--limit", "1", "--allow-network"], archive, 1),
      ).toMatch(/identity/);
      const failed = new Database(join(archive, "documents.sqlite"), {
        readonly: true,
      });
      expect(
        failed.query<any, []>("SELECT COUNT(*) n FROM versions").get().n,
      ).toBe(1);
      expect(
        failed.query<any, []>("SELECT COUNT(*) n FROM representations").get().n,
      ).toBeGreaterThan(0);
      failed.close();
    } finally {
      server.stop(true);
    }
  }, 60000);

test("retained exact publisher HTML: indexed years, blocked HTTP originals and City election notices", async () => {
  const path = process.env.CITY_SOURCE_INPUTS;
  if (!path) throw Error("CITY_SOURCE_INPUTS required");
  const inputs = JSON.parse(readFileSync(path, "utf8"));
  for (const profile of profiles) {
    const source = sourceName(profile.source),
      root = await mkdtemp(join(process.env.TMPDIR!, "city-retained-")),
      engine = await Engine.open(root);
    try {
      const label = source.includes("council")
          ? "council-root"
          : "elections-root",
        r = inputs.find((r: any) => r.label === label),
        body = readFileSync(r.path, "utf8");
      expect(sha(body)).toBe(r.sha256);
      await engine.importPage(source, r.url, body, "retained-original");
      const cat = await engine.discoveryCatalog(source);
      expect(cat[0]!.pages.length).toBeGreaterThan(0);
      if (source.includes("council")) {
        expect(cat[0]!.pages.some((p) => p.label.trim() === "1869")).toBe(true);
        const actual = inputs.find(
          (r: any) => r.label === "council-1869-canonical",
        );
        const html = readFileSync(actual.path, "utf8");
        expect(discover(source, actual.url, html)).toHaveLength(0);
      } else {
        const r = inputs.find((r: any) => r.label === "election-2026");
        await engine.importPage(
          source,
          r.url,
          readFileSync(r.path, "utf8"),
          "retained-original",
        );
        const rows = engine.list(source, {
          limit: 2000,
          role: "election-notice",
        });
        expect(rows.length).toBe(4);
        expect(
          rows.every(
            (r) => r.date === "2026-11-03" && r.administeringCounty === null,
          ),
        ).toBe(true);
      }
      await engine.preflight();
    } finally {
      await engine.close();
    }
  }
});

test("City text identity never falls back to county or fiscal identity and binds exact date/role", () => {
  for (const p of profiles) {
    const row = discover(
      sourceName(p.source),
      p.final,
      `<h1>2030 City of Austin</h1><a href="https://services.austintexas.gov/edims/document.cfm?id=123456">${p.label}</a>`,
    )[0]!;
    expect(row).toBeDefined();
    expect(() => requireTextIdentity(p.title, row)).not.toThrow();
    for (const text of [
      "Travis County " + p.title.replace("City of Austin", ""),
      p.title.replace("January 2", "January 3"),
      "City of Austin Quarterly Financial Report FY 2030",
      "",
    ])
      expect(() => requireTextIdentity(text, row)).toThrow(/identity/);
  }
});
