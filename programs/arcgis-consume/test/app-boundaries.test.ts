import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { main } from "../src/cli";
import { Archive } from "../src/archive";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
const id = "c".repeat(32);
const app = {
  id,
  type: "Web Mapping Application",
  access: "public",
  url: "https://maps.austintexas.gov/OnlyFixture/",
  licenseInfo: "Fixture terms",
  title: "App",
};
const policy = "User-agent: *\nAllow: /\n" + " ".repeat(256);
function setup(c: any) {
  process.on("exit", () => Bun.gc(true));
  const fs = require("node:fs");
  let now = fs.existsSync(c.clock)
    ? Number(fs.readFileSync(c.clock, "utf8"))
    : 0;
  Date.now = () => now;
  Bun.sleep = async (ms: number | Date) => {
    now += Number(ms);
    fs.writeFileSync(c.clock, String(now));
  };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      fs.appendFileSync(c.calls, url + "\n");
      const u = new URL(url);
      if (u.origin !== "https://www.arcgis.com") {
        if (c.service && u.origin === new URL(c.service).origin) {
          if (u.pathname === "/robots.txt")
            return new Response("User-agent: *\nAllow: /\n");
          return Response.json({ layers: [] });
        }
        throw Error("fixture origin");
      }
      if (u.pathname === "/robots.txt") return new Response(c.policy);
      if (u.pathname.endsWith("/search"))
        return Response.json({ total: 1, nextStart: -1, results: [c.app] });
      if (u.pathname.endsWith(c.site + "/data"))
        return Response.json({
          catalogV2: {
            scopes: {
              item: {
                filters: [{ predicates: [{ group: ["e".repeat(32)] }] }],
              },
            },
          },
        });
      if (u.pathname.endsWith(c.site))
        return Response.json({
          ...c.app,
          id: c.site,
          licenseInfo: c.catalogTerms ?? c.app.licenseInfo,
        });
      if (u.pathname.endsWith(c.app.id + "/data")) {
        if (c.partial) {
          let n = 0;
          return new Response(
            new ReadableStream({
              pull(q) {
                if (n++ === 0) q.enqueue(new TextEncoder().encode('{"x":'));
                else q.error(new TypeError("authored interrupted stream"));
              },
            }),
          );
        }
        return new Response(c.body ?? "42");
      }
      if (u.pathname.endsWith(c.app.id)) return Response.json(c.item ?? c.app);
      throw Error("fixture route");
    },
    { preconnect: () => {} },
  );
}
async function fixture(partial = false, budget = "6") {
  const base = await mkdtemp(join(process.env.TMPDIR!, "app-boundary-"));
  const root = join(base, "archive"),
    calls = join(base, "calls"),
    preload = join(base, "preload.ts");
  await writeFile(calls, "");
  await writeFile(
    preload,
    `(${setup.toString()})(${JSON.stringify({ clock: join(base, "clock"), calls, app, site: configs.austin.site, policy, partial })});`,
  );
  const invoke = async (args: string[], online = false) => {
    const p = Bun.spawn(
      [
        process.execPath,
        ...(online ? ["--preload", preload] : []),
        resolve(import.meta.dir, "../src/cli.ts"),
        ...args,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    return {
      out: await new Response(p.stdout).text(),
      err: await new Response(p.stderr).text(),
      exit: await p.exited,
    };
  };
  const args = [
    "inspect-app",
    "--source",
    "austin",
    "--item",
    id,
    "--archive",
    root,
    "--terms-sha256",
    terms(app).sha256,
    "--catalog-terms-sha256",
    terms(app).sha256,
    "--max-requests",
    budget,
  ];
  return { root, calls, args, invoke };
}
async function snapshot(root: string) {
  const db = new Database(join(root, "state.sqlite"), { readonly: true });
  const logical = db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type=? ORDER BY name",
    )
    .all("table")
    .map(({ name }) => [
      name,
      db.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ]);
  db.close();
  Bun.gc(true);
  const files: Record<string, string> = {};
  for (const name of (await readdir(root)).sort())
    if (!name.endsWith("-shm") && !name.includes("lock")) {
      files[name] = createHash("sha256")
        .update(await readFile(join(root, name)))
        .digest("hex");
    }
  return { logical, files };
}
for (const fault of [
  "mode",
  "receipt",
  "joint-downgrade",
  "source",
  "budget",
  "attempt",
  "missing-receipts",
  "historical-route",
])
  test(
    "native app replay refuses " + fault + " without HTTP or durable changes",
    async () => {
      const f = await fixture();
      const good = await f.invoke(f.args, true);
      expect(good.exit).toBe(0);
      const result = JSON.parse(good.out);
      const db = new Database(join(f.root, "state.sqlite"));
      const saved = JSON.parse(
        (
          db
            .query("SELECT options FROM acquisition_options WHERE run=?")
            .get(result.run) as { options: string }
        ).options,
      );
      const summary = JSON.parse(
        (
          db.query("SELECT summary FROM runs WHERE id=?").get(result.run) as {
            summary: string;
          }
        ).summary,
      );
      if (fault === "mode") delete saved.mode;
      if (fault === "receipt") delete saved.receiptVersion;
      if (fault === "joint-downgrade") {
        delete saved.mode;
        delete saved.receiptVersion;
        db.query("UPDATE runs SET summary=NULL WHERE id=?").run(result.run);
      }
      if (fault === "source") saved.source = "voter";
      if (fault === "budget") saved.budget = { ...saved.budget, requests: 99 };
      if (fault === "attempt")
        db.query("UPDATE attempts SET url=? WHERE run=? AND label=?").run(
          "https://www.arcgis.com/wrong",
          result.run,
          "app-data",
        );
      if (fault === "missing-receipts") {
        delete summary.receipts;
        db.query("UPDATE runs SET summary=? WHERE id=?").run(
          JSON.stringify(summary),
          result.run,
        );
      }
      if (fault === "historical-route") {
        const row = db
          .query(
            "SELECT path,sha256,bytes FROM observations WHERE run=? AND label=?",
          )
          .get(result.run, "robots-www.arcgis.com") as {
          path: string;
          sha256: string;
          bytes: number;
        };
        const denied = (
          "User-agent: *\nDisallow: /sharing/rest/content/items/" +
          id +
          "/data\n"
        ).padEnd(row.bytes, " ");
        expect(Buffer.byteLength(denied)).toBe(row.bytes);
        await writeFile(join(f.root, row.path), denied);
        const hash = createHash("sha256").update(denied).digest("hex");
        db.query(
          "UPDATE observations SET sha256=? WHERE run=? AND label=?",
        ).run(hash, result.run, "robots-www.arcgis.com");
        db.query("UPDATE versions SET sha256=? WHERE sha256=?").run(
          hash,
          row.sha256,
        );
        summary.receipts.find(
          (x: any) => x.label === "robots-www.arcgis.com",
        ).sha256 = hash;
        db.query("UPDATE runs SET summary=? WHERE id=?").run(
          JSON.stringify(summary),
          result.run,
        );
      }
      db.query("UPDATE acquisition_options SET options=? WHERE run=?").run(
        JSON.stringify(saved),
        result.run,
      );
      db.close();
      const before = await snapshot(f.root),
        calls = await readFile(f.calls, "utf8");
      for (const args of [["verify", "--archive", f.root], f.args]) {
        const refusal = await f.invoke(args);
        expect(refusal.exit).toBe(1);
        if (fault === "historical-route")
          expect(refusal.err).toContain("historical robots disallows route");
        expect(await snapshot(f.root)).toEqual(before);
        expect(await readFile(f.calls, "utf8")).toBe(calls);
      }
    },
  );
test("native app finite request ceiling and cached bounds refuse without extra requests", async () => {
  const low = await fixture(false, "5");
  const failed = await low.invoke(low.args, true);
  expect(failed.exit).toBe(1);
  expect(failed.err).toContain("ceiling");
  expect((await readFile(low.calls, "utf8")).trim().split("\n")).toHaveLength(
    5,
  );
  const f = await fixture();
  expect((await f.invoke(f.args, true)).exit).toBe(0);
  const before = await snapshot(f.root),
    calls = await readFile(f.calls, "utf8");
  const lower = f.args.map((x) => (x === "6" ? "5" : x));
  expect((await f.invoke(lower)).exit).toBe(1);
  expect(await snapshot(f.root)).toEqual(before);
  expect(await readFile(f.calls, "utf8")).toBe(calls);
});
test("native app respects exclusive existing archive lock", async () => {
  const f = await fixture();
  expect((await f.invoke(f.args, true)).exit).toBe(0);
  const held = await Archive.open(f.root);
  try {
    const before = await readFile(f.calls, "utf8");
    const refused = await f.invoke(f.args, true);
    expect(refused.exit).toBe(1);
    expect(refused.err).toMatch(/lock|locked/);
    expect(await readFile(f.calls, "utf8")).toBe(before);
  } finally {
    await held.close();
  }
});
test("new partial metadata transfer remains held without replacing original facts", async () => {
  const f = await fixture(true);
  expect((await f.invoke(f.args, true)).exit).toBe(1);
  const calls = await readFile(f.calls, "utf8");
  const next = await f.invoke(f.args, true);
  expect(next.exit).toBe(1);
  expect(next.err).toMatch(/unknown|manual review/);
  expect(await readFile(f.calls, "utf8")).toBe(calls);
});
test("cached malformed metadata refuses without adding a new manual hold", async () => {
  const f = await fixture();
  const good = await f.invoke(f.args, true);
  expect(good.exit).toBe(0);
  const result = JSON.parse(good.out);
  const db = new Database(join(f.root, "state.sqlite"));
  const row = db
    .query("SELECT path,sha256 FROM observations WHERE run=? AND label=?")
    .get(result.run, "app-data") as { path: string; sha256: string };
  await writeFile(join(f.root, row.path), "{{");
  const hash = createHash("sha256").update("{{").digest("hex");
  db.query("UPDATE observations SET sha256=? WHERE run=? AND label=?").run(
    hash,
    result.run,
    "app-data",
  );
  db.query("UPDATE versions SET sha256=? WHERE sha256=?").run(hash, row.sha256);
  db.query("UPDATE runs SET status=?,summary=NULL WHERE id=?").run(
    "failed",
    result.run,
  );
  db.close();
  const calls = await readFile(f.calls, "utf8");
  const refused = await f.invoke([...f.args, "--resume", result.run], true);
  expect(refused.exit).toBe(1);
  expect(refused.err).not.toContain("manual review");
  const after = new Database(join(f.root, "state.sqlite"), { readonly: true });
  expect(
    (
      after.query("SELECT not_before FROM cooldown").get() as {
        not_before: number;
      }
    ).not_before,
  ).toBeLessThan(Number.MAX_SAFE_INTEGER);
  after.close();
  expect(await readFile(f.calls, "utf8")).toBe(calls);
});

test("in-process app retention and replay execute the same production seam for coverage", async () => {
  const f = await fixture();
  const original = { fetch: globalThis.fetch, now: Date.now, sleep: Bun.sleep };
  try {
    setup({
      clock: join(f.root, "..", "direct-clock"),
      calls: f.calls,
      app,
      site: configs.austin.site,
      policy,
      partial: false,
    });
    const result = (await main(f.args)) as {
      run: string;
      summary: { metadataOnly: boolean };
    };
    expect(result.summary.metadataOnly).toBe(true);
    expect(
      ((await main(["verify", "--archive", f.root])) as { appMetadata: number })
        .appMetadata,
    ).toBe(1);
    expect(((await main(f.args)) as { reused: boolean }).reused).toBe(true);
  } finally {
    globalThis.fetch = original.fetch;
    Date.now = original.now;
    Bun.sleep = original.sleep;
  }
});

for (const partial of [false, true])
  test(
    "in-process fresh unknown metadata hold coverage " + partial,
    async () => {
      const f = await fixture();
      const original = {
        fetch: globalThis.fetch,
        now: Date.now,
        sleep: Bun.sleep,
      };
      try {
        setup({
          clock: join(f.root, "..", "direct-clock"),
          calls: f.calls,
          app,
          site: configs.austin.site,
          policy,
          partial,
          body: "{",
        });
        await expect(main(f.args)).rejects.toThrow("manual review");
      } finally {
        globalThis.fetch = original.fetch;
        Date.now = original.now;
        Bun.sleep = original.sleep;
      }
    },
  );

const publishedCases: Array<[string, unknown, boolean]> = [
  ["missing", undefined, false],
  ["null", null, false],
  ["empty", "", false],
  ["javascript", "javascript:alert(1)", false],
  ["credentials", "https://user:pass@maps.austintexas.gov/Fixture/", false],
  ["whitespace", " https://maps.austintexas.gov/Fixture/", false],
  ["relative", "/Fixture/", false],
  ["object", {}, false],
  ["malformed-absolute", "https://[", false],
  ["https-original", "https://maps.austintexas.gov/Fixture", true],
  ["http-original", "http://maps.austintexas.gov/Fixture", true],
];
for (const [name, url, usable] of publishedCases)
  test("native published URL prerequisite " + name, async () => {
    const f = await fixture();
    const selected: Record<string, unknown> = { ...app };
    if (url === undefined) delete selected.url;
    else selected.url = url;
    const catalogTerms = "Distinct source catalog fixture terms";
    const config = {
      clock: join(f.root, "..", "url-clock"),
      calls: f.calls,
      app: selected,
      site: configs.austin.site,
      policy,
      partial: false,
      catalogTerms,
    };
    await writeFile(
      join(f.root, "..", "preload.ts"),
      `(${setup.toString()})(${JSON.stringify(config)});`,
    );
    const args = [...f.args];
    args[args.indexOf("--catalog-terms-sha256") + 1] = terms({
      licenseInfo: catalogTerms,
    }).sha256;
    const result = await f.invoke(args, true);
    expect(result.exit).toBe(usable ? 0 : 1);
    const calls = (await readFile(f.calls, "utf8")).trim().split("\n");
    expect(
      calls.filter((u) => new URL(u).pathname.endsWith(id + "/data")),
    ).toHaveLength(usable ? 1 : 0);
    const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
    expect(
      (
        db.query("SELECT not_before FROM cooldown").get() as {
          not_before: number;
        }
      ).not_before,
    ).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(
      db
        .query(
          "SELECT COUNT(*) AS n FROM attempts WHERE finished IS NULL OR error IS NOT NULL",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      db
        .query("SELECT COUNT(*) AS n FROM observations WHERE label=?")
        .get("app-data"),
    ).toEqual({ n: usable ? 1 : 0 });
    db.close();
    if (usable) {
      expect(JSON.parse(result.out).summary).toMatchObject({
        metadataOnly: true,
        wrapperResolved: false,
        outcome: "unsupported",
      });
      expect((await f.invoke(["verify", "--archive", f.root])).exit).toBe(0);
    } else expect(result.err).toContain("published URL");
  });
test("native item URL must equal the valid catalog literal exactly", async () => {
  const f = await fixture();
  const config = {
    clock: join(f.root, "..", "url-clock"),
    calls: f.calls,
    app,
    site: configs.austin.site,
    policy,
    partial: false,
    item: { ...app, url: app.url + "?alias=1" },
  };
  await writeFile(
    join(f.root, "..", "preload.ts"),
    `(${setup.toString()})(${JSON.stringify(config)});`,
  );
  const result = await f.invoke(f.args, true);
  expect(result.exit).toBe(0);
  expect(JSON.parse(result.out).summary).toMatchObject({
    outcome: "item-unavailable",
    metadataOnly: true,
    wrapperResolved: false,
  });
  expect(
    (await readFile(f.calls, "utf8"))
      .split("\n")
      .filter((u) => u.includes(id + "/data")),
  ).toHaveLength(0);
});

for (const [name, url, usable] of publishedCases)
  test("in-process published URL guard coverage " + name, async () => {
    const f = await fixture();
    const selected: Record<string, unknown> = { ...app };
    if (url === undefined) delete selected.url;
    else selected.url = url;
    const original = {
      fetch: globalThis.fetch,
      now: Date.now,
      sleep: Bun.sleep,
    };
    try {
      setup({
        clock: join(f.root, "..", "direct-url-clock"),
        calls: f.calls,
        app: selected,
        site: configs.austin.site,
        policy,
        partial: false,
      });
      if (usable) {
        const result = (await main(f.args)) as {
          summary: { metadataOnly: boolean };
        };
        expect(result.summary.metadataOnly).toBe(true);
      } else await expect(main(f.args)).rejects.toThrow("published URL");
      expect(
        (await readFile(f.calls, "utf8"))
          .split("\n")
          .filter((u) => u.includes(id + "/data")),
      ).toHaveLength(usable ? 1 : 0);
    } finally {
      globalThis.fetch = original.fetch;
      Date.now = original.now;
      Bun.sleep = original.sleep;
    }
  });

const appTermsCatalog = "Separate app-terms catalog license";
const otherService =
  "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/NarrowFixture/FeatureServer";
async function appTermsFixture(kind = "app", currentOnly = false) {
  const f = await fixture();
  const selected =
    currentOnly || kind === "app"
      ? app
      : { ...app, type: kind, url: otherService };
  const config = {
    clock: join(f.root, "..", "rules-clock"),
    calls: f.calls,
    app: selected,
    site: configs.austin.site,
    policy,
    partial: false,
    catalogTerms: appTermsCatalog,
    service: otherService,
    ...(currentOnly ? { item: { ...app, type: kind, url: otherService } } : {}),
  };
  await writeFile(
    join(f.root, "..", "preload.ts"),
    `(${setup.toString()})(${JSON.stringify(config)});`,
  );
  const args = [
    "rules",
    "--app-only",
    "--source",
    "austin",
    "--item",
    id,
    "--archive",
    f.root,
    "--max-requests",
    "32",
  ];
  return { ...f, args, config };
}
for (const [role, drift] of [
  ["Feature Service", false],
  ["Map Service", false],
  ["Feature Service", true],
] as const)
  test(
    "native app-only terms blocks current " +
      role +
      " before another authority drift=" +
      drift,
    async () => {
      const f = await appTermsFixture(role, drift);
      const result = await f.invoke(f.args, true);
      const calls = (await readFile(f.calls, "utf8")).trim().split("\n");
      expect(
        calls.filter((u) => new URL(u).origin !== "https://www.arcgis.com"),
      ).toHaveLength(0);
      expect(calls.filter((u) => u.includes(id + "/data"))).toHaveLength(0);
      expect(result.exit).toBe(1);
      expect(result.err).toContain("app-only");
      const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
      expect(
        db
          .query("SELECT COUNT(*) AS n FROM observations WHERE label=?")
          .get("item-before"),
      ).toEqual({ n: 1 });
      expect(
        db
          .query(
            "SELECT COUNT(*) AS n FROM attempts WHERE finished IS NULL OR error IS NOT NULL",
          )
          .get(),
      ).toEqual({ n: 0 });
      expect(
        (
          db.query("SELECT not_before FROM cooldown").get() as {
            not_before: number;
          }
        ).not_before,
      ).toBeLessThan(Number.MAX_SAFE_INTEGER);
      db.close();
    },
  );
test("native app-only terms emits distinct current terms using Portal only", async () => {
  const f = await appTermsFixture();
  const result = await f.invoke(f.args, true);
  expect(result.err).toBe("");
  expect(result.exit).toBe(0);
  const summary = JSON.parse(result.out).summary;
  expect(summary).toMatchObject({
    appOnly: true,
    metadataOnly: true,
    wrapperResolved: false,
    service: null,
  });
  expect(summary.terms.sha256).toBe(terms(app).sha256);
  expect(summary.catalogTerms.sha256).toBe(
    terms({ licenseInfo: appTermsCatalog }).sha256,
  );
  expect(summary.terms.sha256).not.toBe(summary.catalogTerms.sha256);
  const calls = (await readFile(f.calls, "utf8")).trim().split("\n");
  expect(calls).toHaveLength(5);
  expect(
    calls.every((u) => new URL(u).origin === "https://www.arcgis.com"),
  ).toBe(true);
  expect(calls.filter((u) => u.includes(id + "/data"))).toHaveLength(0);
});
test("native ordinary rules keeps advertised service inspection when app-only omitted", async () => {
  const f = await appTermsFixture("Feature Service");
  const result = await f.invoke(
    f.args.filter((x) => x !== "--app-only"),
    true,
  );
  expect(result.exit).toBe(0);
  expect(
    (await readFile(f.calls, "utf8"))
      .split("\n")
      .filter((u) => u.startsWith(new URL(otherService).origin)),
  ).toHaveLength(2);
  expect(JSON.parse(result.out).summary.service).toEqual({ layers: [] });
});
test("native app-only guards fail before archive mutation and informationals remain offline", async () => {
  const f = await appTermsFixture();
  const root = join(f.root, "..", "absent");
  for (const args of [
    ["rules", "--app-only", "--source", "water", "--item", id],
    ["rules", "--app-only", "--source", "austin"],
    ["rules", "--app-only", "--source", "austin", "--item", "bad"],
    ["rules", "--app-only", "--app-only", "--source", "austin", "--item", id],
    [
      "collect",
      "--app-only",
      "--source",
      "austin",
      "--item",
      id,
      "--terms-sha256",
      "a".repeat(64),
    ],
    ["rules", "--app-only", "--source", "austin", "--item", id, "--layer", "0"],
  ]) {
    const result = await f.invoke([...args, "--archive", root], true);
    expect(result.exit).toBe(1);
    expect(existsSync(root)).toBe(false);
  }
  for (const info of ["--help", "--version"]) {
    const result = await f.invoke([
      "rules",
      "--app-only",
      "--source",
      "invalid",
      "--archive",
      "/dev/null",
      info,
    ]);
    expect(result.exit).toBe(0);
    expect(result.err).toBe("");
    if (info === "--help") expect(result.out).toContain("--app-only");
  }
  expect(await readFile(f.calls, "utf8")).toBe("");
});

test("native app-only requires actual catalog membership and immutable resume scope", async () => {
  const f = await appTermsFixture();
  const absent = [...f.args];
  absent[absent.indexOf("--item") + 1] = "d".repeat(32);
  const refused = await f.invoke(absent, true);
  expect(refused.exit).toBe(1);
  expect(refused.err).toContain("absent from authoritative catalog");
  expect(
    (await readFile(f.calls, "utf8"))
      .split("\n")
      .filter((u) => u.includes("/items/" + "d".repeat(32))),
  ).toHaveLength(0);
  const good = await f.invoke(f.args, true);
  expect(good.exit).toBe(0);
  const run = JSON.parse(good.out).run;
  const before = await readFile(f.calls, "utf8");
  const changed = await f.invoke(
    [...f.args.filter((x) => x !== "--app-only"), "--resume", run],
    true,
  );
  expect(changed.exit).toBe(1);
  expect(changed.err).toContain("resume selection/budget changed");
  expect(await readFile(f.calls, "utf8")).toBe(before);
});
for (const kind of ["app", "Feature Service", "Map Service"])
  test("in-process app-only terms restriction coverage " + kind, async () => {
    const f = await appTermsFixture(kind);
    const original = {
      fetch: globalThis.fetch,
      now: Date.now,
      sleep: Bun.sleep,
    };
    try {
      setup(f.config);
      if (kind === "app") {
        const result = (await main(f.args)) as {
          summary: { appOnly: boolean };
        };
        expect(result.summary.appOnly).toBe(true);
      } else await expect(main(f.args)).rejects.toThrow("app-only");
      expect(
        (await readFile(f.calls, "utf8"))
          .trim()
          .split("\n")
          .every((u) => new URL(u).origin === "https://www.arcgis.com"),
      ).toBe(true);
    } finally {
      globalThis.fetch = original.fetch;
      Date.now = original.now;
      Bun.sleep = original.sleep;
    }
  });
