import { collect, discover, verifyAcquisition } from "../src/acquisition";
import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const header =
  "Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate";
const csv = (year: number) =>
  `${header}\n${year},2026-10-01,0001,Authored,0002,1.01,,A,001,Example,002,fixture,\n`;
function setup() {
  const root = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, "acquire-"));
  roots.push(root);
  const sourceArchive = join(root, "source"),
    output = join(root, "import");
  for (const dir of [sourceArchive, output]) mkdirSync(dir, { mode: 0o700 });
  return { sourceArchive, output, fiscalYear: 2032 };
}
test("CSV and HEAD acquisition never request robots, including refresh and offline verification", async () => {
  const options = setup();
  let time = Date.now();
  const calls: string[] = [];
  const deps = {
    now: () => time,
    sleep: async (ms: number) => { time += ms; },
    fetch: async (url: string, init: RequestInit) => {
      calls.push(url);
      if (new URL(url).pathname === "/robots.txt") throw Error("robots network denied");
      return init.method === "HEAD" ? new Response(null) : new Response(csv(2032));
    },
  };
  await collect(options, deps);
  await collect({ ...options, refresh: true }, deps);
  await discover({ ...options, years: [2032] }, deps);
  await verifyAcquisition(options.sourceArchive, options.output);
  expect(calls).toHaveLength(3);
  const db = new Database(join(options.sourceArchive, "state.sqlite"), { readonly: true });
  expect(db.query("SELECT count(*) n FROM attempts WHERE label='robots'").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) n FROM observations WHERE label='robots'").get()).toEqual({ n: 0 });
  db.close();
  expect(await collect(options, { ...deps, fetch: async () => { throw Error("all network denied"); } })).toMatchObject({ reused: true });
});

test("explicit refresh retains distinct immutable snapshots and default chooses latest verified one", async () => {
  const options = setup();
  let calls = 0,
    time = Date.now();
  const dependencies = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async (url: string) => {
      calls++;
      return url.endsWith("robots.txt")
        ? new Response("", { status: 404 })
        : new Response(
            csv(2032).replace("1.01", calls === 1 ? "1.01" : "2.02"),
          );
    },
  };
  const first = await collect(options, dependencies);
  const second = await collect({ ...options, refresh: true }, dependencies);
  expect(
    "fileSHA256" in first &&
      "fileSHA256" in second &&
      first.fileSHA256 !== second.fileSHA256,
  ).toBe(true);
  expect(await collect(options, dependencies)).toMatchObject({
    fileSHA256: (second as any).fileSHA256,
    reused: true,
  });
  expect(calls).toBe(2);
  expect(
    await verifyAcquisition(options.sourceArchive, options.output),
  ).toMatchObject({ bindings: 2 });
});
test("collect arbitrary-year octet-stream through shared archive and verify bound import with zero-HTTP reuse", async () => {
  const module = (await import("../src/acquisition").catch(() => ({}))) as any;
  expect(typeof module.collect).toBe("function");
  const options = setup();
  let calls = 0,
    time = Date.now();
  const dependencies = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async (url: string, init: RequestInit) => {
      calls++;
      expect(init.redirect).toBe("manual");
      return url.endsWith("robots.txt")
        ? new Response("absent", { status: 404 })
        : new Response(csv(2032), {
            headers: { "content-type": "application/octet-stream" },
          });
    },
  };
  const first = await module.collect(options, dependencies);
  expect(first).toMatchObject({
    fiscalYear: 2032,
    accepted: 1,
    rejected: 0,
    reused: false,
    status: "imported",
  });
  expect(calls).toBe(1);
  expect(await module.collect(options, dependencies)).toMatchObject({
    reused: true,
    fileSHA256: first.fileSHA256,
  });
  expect(calls).toBe(1);
  expect(
    await module.verifyAcquisition(options.sourceArchive, options.output),
  ).toMatchObject({ integrity: "ok", bindings: 1, httpRequests: 0 });
});

test("caller-bounded discovery performs HEAD only; missing year cached explicitly and no fixed allowlist", async () => {
  const module = (await import("../src/acquisition")) as any;
  expect(typeof module.discover).toBe("function");
  const options = setup();
  const methods: string[] = [];
  let time = Date.now();
  const dependencies = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async (url: string, init: RequestInit) => {
      methods.push(init.method ?? "GET");
      if (url.endsWith("robots.txt")) return new Response("", { status: 404 });
      expect(init.method).toBe("HEAD");
      return new Response(null, {
        status: url.endsWith("2033.csv") ? 404 : 200,
        headers: {
          "content-length": "38248830",
          "content-type": "application/octet-stream",
        },
      });
    },
  };
  const result = await module.discover(
    { ...options, years: [2032, 2033] },
    dependencies,
  );
  expect(result).toMatchObject({
    catalog: "caller_bounded_candidates",
    completeHistory: false,
    candidates: [
      {
        fiscalYear: 2032,
        status: "metadata_available",
        declaredBytes: 38248830,
        contentValidated: false,
      },
      { fiscalYear: 2033, status: "unavailable", contentValidated: false },
    ],
  });
  expect(methods).toEqual(["HEAD", "HEAD"]);
  expect(
    await module.discover({ ...options, years: [2032, 2033] }, dependencies),
  ).toMatchObject({ reused: true });
  expect(methods).toHaveLength(2);
});
