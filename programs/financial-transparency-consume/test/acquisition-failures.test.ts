import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { collect, verifyAcquisition } from "../src/acquisition";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const header =
  "Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate";
function setup() {
  const root = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, "fault-"));
  roots.push(root);
  const sourceArchive = join(root, "source"),
    output = join(root, "import");
  for (const dir of [sourceArchive, output]) mkdirSync(dir, { mode: 0o700 });
  return { sourceArchive, output, fiscalYear: 2035 };
}
test("200 cooldown persists across reopen and arbitrary-year second snapshot exceeds old body cap", async () => {
  const options = setup();
  let time = Date.now();
  const starts: number[] = [];
  const deps = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async (url: string) => {
      starts.push(time);
      if (url.endsWith("robots.txt")) return new Response("", { status: 404 });
      const year = Number(/_(\d+)\.csv$/.exec(url)![1]);
      return new Response(csv(year).replace("fixture", "x".repeat(6_000_000)), {
        headers: {
          "retry-after": "10",
          "content-type": "application/octet-stream",
        },
      });
    },
  };
  const first = await collect(options, deps);
  expect(first).toMatchObject({ accepted: 1 });
  const second = await collect({ ...options, fiscalYear: 1998 }, deps);
  expect(second).toMatchObject({ fiscalYear: 1998, accepted: 1 });
  expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(10000);
  expect(
    await verifyAcquisition(options.sourceArchive, options.output),
  ).toMatchObject({ bindings: 2 });
  const originals = readdirSync(options.output).filter((name) =>
    name.endsWith(".csv"),
  );
  expect(originals).toHaveLength(2);
}, 30000);
test("wrong source-year including quarantined-width row never creates import batch", async () => {
  const options = setup(),
    wire = transport(csv(2034).replace("fixture,", "fixture,,"));
  await expect(collect(options, wire.dependencies)).rejects.toThrow(
    "source year mismatch",
  );
  expect(readdirSync(options.output)).toEqual([]);
  const db = new Database(join(options.sourceArchive, "state.sqlite"));
  expect(db.query("SELECT count(*) n FROM attempts").get()).toEqual({ n: 2 });
  expect(
    db.query("SELECT count(*) n FROM observations WHERE label='csv'").get(),
  ).toEqual({ n: 0 });
  db.close();
  await expect(collect(options, wire.dependencies)).rejects.toThrow();
  expect(wire.calls).toBe(2);
});
test.each(["dangling", "resolving", "orphan", "lock"])(
  "unsafe source %s is refused with zero transport",
  async (kind) => {
    const options = setup(),
      wire = transport();
    const name =
      kind === "lock"
        ? ".civicclerk.lock"
        : "00000000-0000-0000-0000-000000000000.body";
    const target = join(options.sourceArchive, name),
      sentinel = join(options.output, "..", "sentinel");
    writeFileSync(sentinel, "keep", { mode: 0o600 });
    if (kind === "dangling")
      symlinkSync(join(options.sourceArchive, "missing"), target);
    else if (kind === "resolving") symlinkSync(sentinel, target);
    else writeFileSync(target, "keep", { mode: 0o600 });
    await expect(collect(options, wire.dependencies)).rejects.toThrow();
    expect(wire.calls).toBe(0);
    expect(readFileSync(sentinel, "utf8")).toBe("keep");
  },
);
test("killed transport retains reserved attempt and lock; restart never silently retries", async () => {
  const options = setup();
  const script = `import {collect} from ${JSON.stringify(join(import.meta.dir, "../src/acquisition.ts"))};let time=Date.now();await collect(${JSON.stringify({ ...options, maxBytes: 4000000, maxTotalBytes: 8000000 })},{now:()=>time,sleep:async(ms)=>{time+=ms;},fetch:async(url)=>{if(url.endsWith('robots.txt'))return new Response('',{status:404});process.kill(process.pid,'SIGKILL');return new Promise(()=>{});}});`;
  const child = Bun.spawnSync([process.execPath, "-e", script], {
    timeout: 5000,
  });
  expect(child.exitCode).not.toBe(0);
  const db = new Database(join(options.sourceArchive, "state.sqlite"));
  expect(
    db
      .query("SELECT bytes,finished,status FROM attempts WHERE label='csv'")
      .get(),
  ).toEqual({ bytes: 4000000, finished: null, status: null });
  db.close();
  const wire = transport();
  await expect(collect(options, wire.dependencies)).rejects.toThrow();
  expect(wire.calls).toBe(0);
  // Test-only operator recovery simulation: removing a lock must not erase accounting.
  rmSync(join(options.sourceArchive, ".civicclerk.lock"));
  await expect(
    collect({ ...options, refresh: true }, wire.dependencies),
  ).rejects.toThrow("unfinished transport timing: operator review required");
  const retained = new Database(join(options.sourceArchive,"state.sqlite"),{readonly:true});
  expect(retained.query("SELECT bytes,finished,status FROM attempts WHERE label='csv'").get()).toEqual({bytes:4000000,finished:null,status:null});
  expect(retained.query("SELECT phase FROM timing_events WHERE attempt=(SELECT id FROM attempts WHERE label='csv') AND phase IN ('dispatch','complete') ORDER BY rowid").all()).toEqual([{phase:'dispatch'}]);
  retained.close();
  expect(wire.calls).toBe(0);
});
test.each([
  "request",
  "file",
  "aggregate",
  "rows",
  "redirect",
  "challenge",
  "policy",
])(
  "bounded %s failure never imports or performs hidden retry",
  async (kind) => {
    const options = setup();
    let calls = 0,
      time = Date.now();
    const deps = {
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
      fetch: async (url: string) => {
        calls++;
        if (url.endsWith("robots.txt"))
          return kind === "policy"
            ? new Response("User-agent: *\nDisallow: /Reports/")
            : new Response("", { status: 404 });
        if (kind === "redirect")
          return new Response(null, {
            status: 302,
            headers: { location: "https://invalid.example/" },
          });
        if (kind === "challenge") return new Response("<html>challenge</html>");
        return new Response(csv() + csv().split("\n")[1] + "\n", {
          headers: { "content-length": "500" },
        });
      },
    };
    const limits =
      kind === "request"
        ? { maxRequests: 1 }
        : kind === "file"
          ? { maxBytes: 100 }
          : kind === "aggregate"
            ? { maxTotalBytes: 100 }
            : kind === "rows"
              ? { maxRows: 1 }
              : {};
    await expect(collect({ ...options, ...limits }, deps)).rejects.toThrow();
    const count = calls;
    expect(calls).toBe(kind === "policy" || kind === "request" ? 1 : 2);
    expect(readdirSync(options.output)).toEqual([]);
    await expect(collect({ ...options, ...limits }, deps)).rejects.toThrow();
    expect(calls).toBe(count);
    if (kind === "policy") {
      await expect(
        collect({ ...options, refresh: true }, deps),
      ).rejects.toThrow("robots restriction");
      expect(calls).toBe(count);
    }
  },
);
test("foreign acquisition database is refused unchanged before shared Store can initialize it", async () => {
  const options = setup(),
    wire = transport(),
    path = join(options.sourceArchive, "state.sqlite");
  const db = new Database(path);
  db.exec("CREATE TABLE unrelated(id TEXT)");
  db.close();
  chmodSync(path, 0o600);
  const original = readFileSync(path);
  await expect(collect(options, wire.dependencies)).rejects.toThrow();
  expect(wire.calls).toBe(0);
  expect(readFileSync(path)).toEqual(original);
});
test("header-only source cannot claim semantically validated fiscal year", async () => {
  const options = setup(),
    wire = transport(header + "\n");
  await expect(collect(options, wire.dependencies)).rejects.toThrow(
    "source year unverified",
  );
  expect(readdirSync(options.output)).toEqual([]);
});
test("bounded exact file/aggregate/row limits are inclusive", async () => {
  const options = setup(),
    wire = transport();
  expect(
    await collect(
      {
        ...options,
        maxBytes: Buffer.byteLength(csv()),
        maxTotalBytes: Buffer.byteLength(csv()),
        maxRows: 1,
      },
      wire.dependencies,
    ),
  ).toMatchObject({ rowsRead: 1, accepted: 1 });
  expect(wire.calls).toBe(2);
});
test.each([
  { ratelimit: '"default";r=0;t=12' },
  { "ratelimit-remaining": "0", "ratelimit-reset": "12" },
  { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000030" },
])(
  "bounded successful server cooldown survives reopen: %j",
  async (headers) => {
    const options = setup();
    let time = 2_000_000_000_000;
    const starts: number[] = [];
    const dependencies = {
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
      fetch: async (url: string) => {
        starts.push(time);
        if (url.endsWith("robots.txt"))
          return new Response("", { status: 404 });
        const year = Number(/_(\d+)\.csv$/.exec(url)![1]);
        return new Response(csv(year), {
          headers: Object.fromEntries(Object.entries(headers)),
        });
      },
    };
    await collect(options, dependencies);
    await collect({ ...options, fiscalYear: 1984 }, dependencies);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(12000);
  },
);
test("bounded cached robots Crawl-delay is re-applied after restart", async () => {
  const options = setup();
  let time = Date.now();
  const starts: number[] = [];
  const dependencies = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async (url: string) => {
      starts.push(time);
      if (url.endsWith("robots.txt"))
        return new Response("User-agent: *\nCrawl-delay: 7\n");
      return new Response(csv(Number(/_(\d+)\.csv$/.exec(url)![1])));
    },
  };
  await collect(options, dependencies);
  await collect({ ...options, fiscalYear: 1984 }, dependencies);
  expect(starts).toHaveLength(3);
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(7000);
  expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(7000);
});
const csv = (year = 2035) =>
  `${header}\n${year},2026-10-01,0001,Authored,0002,1.01,,A,001,Example,002,fixture,\n`;
function transport(body = csv(), headers: Record<string, string> = {}) {
  let time = Date.now(),
    calls = 0;
  const starts: number[] = [];
  return {
    get calls() {
      return calls;
    },
    starts,
    dependencies: {
      now: () => time,
      sleep: async (ms: number) => {
        time += ms;
      },
      fetch: async (url: string) => {
        calls++;
        starts.push(time);
        return url.endsWith("robots.txt")
          ? new Response("", { status: 404 })
          : new Response(body, { headers });
      },
    },
  };
}
test.each([
  "receipt_url",
  "receipt_year",
  "receipt_hash",
  "receipt_count",
  "receipt_status",
  "options_year",
  "attempt_url",
  "attempt_status",
  "source_identity",
  "observation_kind",
  "run_status",
  "run_command",
])("offline semantic binding rejects %s without HTTP", async (kind) => {
  const options = setup(),
    wire = transport();
  await collect(options, wire.dependencies);
  const db = new Database(join(options.sourceArchive, "state.sqlite"));
  const mutations: Record<string, string> = {
    run_status: "UPDATE runs SET status='failed' WHERE command='collect'",
    run_command: "UPDATE runs SET command='sync' WHERE command='collect'",
    receipt_url:
      "UPDATE runs SET summary=json_set(summary,'$.acquisitionURL','https://invalid.example/file') WHERE command='collect'",
    receipt_year:
      "UPDATE runs SET summary=json_set(summary,'$.fiscalYear',2034) WHERE command='collect'",
    receipt_hash:
      "UPDATE runs SET summary=json_set(summary,'$.fileSHA256','unrelated') WHERE command='collect'",
    receipt_count:
      "UPDATE runs SET summary=json_set(summary,'$.rowsRead',9) WHERE command='collect'",
    receipt_status:
      "UPDATE runs SET summary=json_set(summary,'$.status','imported_with_rejections') WHERE command='collect'",
    options_year:
      "UPDATE acquisition_options SET options=json_set(options,'$.fiscalYear',2034)",
    attempt_url:
      "UPDATE attempts SET url='https://invalid.example/file' WHERE label='csv'",
    attempt_status: "UPDATE attempts SET status=403 WHERE label='csv'",
    observation_kind: "UPDATE observations SET kind='zip' WHERE label='csv'",
    source_identity:
      "UPDATE sources SET original_url='https://invalid.example/'",
  };
  db.exec(mutations[kind]);
  db.close();
  await expect(
    verifyAcquisition(options.sourceArchive, options.output),
  ).rejects.toThrow();
  await expect(collect(options, wire.dependencies)).rejects.toThrow();
  expect(wire.calls).toBe(2);
});
test.each(["lock", "dangling", "resolving", "orphan"])(
  "invalid import output %s rejects before any source request",
  async (kind) => {
    const options = setup(),
      wire = transport();
    const target = join(
      options.output,
      kind === "lock" ? ".lock" : "state.sqlite",
    );
    if (kind === "dangling")
      symlinkSync(join(options.output, "missing"), target);
    else if (kind === "resolving") {
      const sentinel = join(options.output, "..", "sentinel");
      writeFileSync(sentinel, "keep", { mode: 0o600 });
      symlinkSync(sentinel, target);
    } else writeFileSync(target, "keep", { mode: 0o600 });
    await expect(collect(options, wire.dependencies)).rejects.toThrow();
    expect(wire.calls).toBe(0);
  },
);
test("unavailable selection caches status with zero HTTP until explicit refresh", async () => {
  const options = setup();
  let calls = 0,
    time = Date.now();
  const deps = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async () => {
      calls++;
      return new Response("", { status: 404 });
    },
  };
  expect(await collect(options, deps)).toMatchObject({
    status: "unavailable",
    reused: false,
  });
  expect(await collect(options, deps)).toMatchObject({
    status: "unavailable",
    reused: true,
  });
  expect(calls).toBe(2);
});
