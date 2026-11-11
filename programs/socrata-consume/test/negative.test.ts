import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");
const cli = resolve(import.meta.dir, "../src/cli.ts");
import { fixture } from "./support/fixture";
import { inspect, verify } from "../src/collector";

test("library terminal negative has a durable decision and read-only offline replay", async () => {
  const root = mkdtempSync(join(base, "library-negative-")),
    f = fixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url: string) =>
    new URL(url).pathname === "/api/catalog/v1"
      ? Response.json({ results: [], resultSetSize: 0 })
      : fetch(url);
  await expect(inspect({ root, asset: "5uaf-hku2" }, f.deps)).rejects.toThrow(
    "asset absent",
  );
  const before = state(root),
    count = f.calls.length;
  expect((await verify(root)).httpRequests).toBe(0);
  expect(f.calls.length).toBe(count);
  expect(state(root)).toEqual(before);
});
function state(root: string) {
  const files: Record<string, string> = {};
  function walk(path: string, prefix = "") {
    for (const d of readdirSync(path, { withFileTypes: true })) {
      const key = join(prefix, d.name);
      if (d.isDirectory()) walk(join(path, d.name), key);
      else if (!d.name.endsWith("-shm"))
        files[key] = createHash("sha256")
          .update(readFileSync(join(path, d.name)))
          .digest("hex");
    }
  }
  const db = new Database(join(root, "transport/state.sqlite"), {
    readonly: true,
  });
  const tables: Record<string, unknown> = {};
  for (const row of db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all())
    tables[row.name] = db
      .query('SELECT * FROM "' + row.name + '" ORDER BY rowid')
      .all();
  db.close();
  walk(root);
  return { files, tables };
}
async function native(args: string[], endpoint: string, entry = cli) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      resolve(entry, "../../test/support/native-preload.ts"),
      entry,
      ...args,
    ],
    {
      cwd: base,
      env: { ...Bun.env, SOCRATA_FIXTURE_ORIGIN: endpoint },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exit };
}
test("native same empty catalog: discover positive and inspect terminal negative both verify unchanged with zero HTTP", async () => {
  const calls: string[] = [];
  const body = JSON.stringify({ results: [], resultSetSize: 0 });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = req.headers.get("x-fixture-source")!;
      calls.push(url);
      return new Response(
        new URL(url).pathname === "/robots.txt"
          ? "User-agent: *\nAllow: /\n"
          : body,
      );
    },
  });
  try {
    for (const command of [
      ["discover", "--query", "authored", "--limit", "1"],
      ["inspect", "5uaf-hku2"],
    ]) {
      const root = mkdtempSync(join(base, "negative-"));
      const n = calls.length;
      const producer = await native(
        [...command, "--archive", root, "--json"],
        server.url.href,
      );
      expect(producer.exit).toBe(command[0] === "inspect" ? 1 : 0);
      if (command[0] === "inspect")
        expect(producer.stderr).toContain("asset absent");
      expect(calls.length - n).toBe(2);
      const before = state(root);
      const verified = await native(
        ["verify", "--archive", root, "--json"],
        server.url.href,
      );
      expect(verified.stderr).toBe("");
      expect(verified.exit).toBe(0);
      expect(JSON.parse(verified.stdout).httpRequests).toBe(0);
      expect(calls.length - n).toBe(2);
      expect(state(root)).toEqual(before);
      if (command[0] === "inspect") {
        const db = new Database(join(root, "transport/state.sqlite"), {
          readonly: true,
        });
        const run = db
          .query<{ status: string; summary: string }, []>(
            "SELECT status,summary FROM runs",
          )
          .get()!;
        expect(run.status).toBe("failed");
        expect(JSON.parse(run.summary).catalogDecision.outcome).toBe(
          "member-absent",
        );
        expect(
          db.query("SELECT 1 FROM observations WHERE label='catalog'").get(),
        ).not.toBeNull();
        db.close();
      }
    }
  } finally {
    server.stop(true);
  }
});

function catalogService(body: string | Uint8Array<ArrayBuffer>) {
  const calls: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = req.headers.get("x-fixture-source")!;
      calls.push(url);
      return new Response(
        new URL(url).pathname === "/robots.txt"
          ? "User-agent: *\nAllow: /\n"
          : body,
      );
    },
  });
  return { calls, server };
}
async function rejectsUnchanged(
  root: string,
  endpoint: string,
  calls: string[],
  category: string,
) {
  const before = state(root),
    n = calls.length;
  const result = await native(
    ["verify", "--archive", root, "--json"],
    endpoint,
  );
  expect(result.exit).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(category);
  expect(calls.length).toBe(n);
  expect(state(root)).toEqual(before);
}
test("native negative replay binds every decision field and refuses missing or downgraded receipts without repair", async () => {
  const s = catalogService('{"results":[],"resultSetSize":0}');
  const original = mkdtempSync(join(base, "negative-original-"));
  try {
    expect(
      (
        await native(
          ["inspect", "5uaf-hku2", "--archive", original],
          s.server.url.href,
        )
      ).exit,
    ).toBe(1);
    const mutations: ((db: Database) => void)[] = [
      (db) => {
        db.exec("UPDATE runs SET summary=NULL");
      },
      (db) => {
        db.exec(
          "DELETE FROM observations WHERE label='catalog'; DELETE FROM versions WHERE label='catalog'; UPDATE runs SET summary=NULL",
        );
      },
      (db) => {
        db.exec("UPDATE runs SET status='succeeded'");
      },
      (db) => {
        const row = db
          .query<{ options: string }, []>(
            "SELECT options FROM acquisition_options",
          )
          .get()!;
        const o = JSON.parse(row.options);
        o.format = "socrata-v2-datahub";
        db.query("UPDATE acquisition_options SET options=?").run(
          JSON.stringify(o),
        );
      },
    ];
    const db = new Database(join(original, "transport/state.sqlite"), {
      readonly: true,
    });
    const summary = JSON.parse(
      db.query<{ summary: string }, []>("SELECT summary FROM runs").get()!
        .summary,
    );
    db.close();
    for (const key of Object.keys(summary.catalogDecision)) {
      for (const missing of [true, false])
        mutations.push((db) => {
          const value = structuredClone(summary);
          if (missing) delete value.catalogDecision[key];
          else
            value.catalogDecision[key] =
              typeof value.catalogDecision[key] === "number" ? 999 : "tampered";
          db.query("UPDATE runs SET summary=?").run(JSON.stringify(value));
        });
    }
    mutations.push((db) => {
      const row = db
        .query<{ options: string }, []>(
          "SELECT options FROM acquisition_options",
        )
        .get()!;
      const o = JSON.parse(row.options);
      o.asset = "abcd-1234";
      db.query("UPDATE acquisition_options SET options=?").run(
        JSON.stringify(o),
      );
    });
    for (const mutate of mutations) {
      const root = mkdtempSync(join(base, "negative-fault-"));
      cpSync(original, root, { recursive: true });
      const db = new Database(join(root, "transport/state.sqlite"));
      mutate(db);
      db.close();
      await rejectsUnchanged(root, s.server.url.href, s.calls, "");
    }
  } finally {
    s.server.stop(true);
  }
});
const item = {
  resource: { id: "5uaf-hku2", name: "Authored", type: "dataset" },
  metadata: { domain: "datahub.austintexas.gov" },
  link: "https://datahub.austintexas.gov/d/5uaf-hku2",
};
test("native invalid catalog admission retains true unknown holds including count inconsistency", async () => {
  const faults = [
    JSON.stringify({
      results: [{ ...item, metadata: { domain: "foreign.test" } }],
      resultSetSize: 1,
    }),
    JSON.stringify({
      results: [{ ...item, link: "https://foreign.test/d/5uaf-hku2" }],
      resultSetSize: 1,
    }),
    '{"results":{},"resultSetSize":0}',
    '{"results":[],"resultSetSize":-1}',
    '{"results":[],"resultSetSize":1}',
    JSON.stringify({ results: [item], resultSetSize: 0 }),
    '{"results":[',
    new Uint8Array([0xff, 0xfe]),
  ];
  for (const body of faults) {
    const s = catalogService(body),
      root = mkdtempSync(join(base, "catalog-invalid-"));
    try {
      const result = await native(
        ["inspect", "5uaf-hku2", "--archive", root],
        s.server.url.href,
      );
      expect(result.exit).toBe(1);
      expect(s.calls.length).toBe(2);
      await rejectsUnchanged(root, s.server.url.href, s.calls, "unknown");
    } finally {
      s.server.stop(true);
    }
  }
});

test("native current members and genuine v2 successful producers verify; genuine old negative stays unknown", async () => {
  const old = process.env.SOCRATA_OLD_CLI;
  if (!old)
    throw Error(
      "set SOCRATA_OLD_CLI to the exact baseline producer entrypoint",
    );
  for (const entry of [cli, old]) {
    const f = fixture("abcd-1234", 3, null);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        return f.deps.fetch(req.headers.get("x-fixture-source")!);
      },
    });
    const root = mkdtempSync(join(base, "member-producer-"));
    try {
      const producer = await native(
        ["inspect", "abcd-1234", "--archive", root, "--json"],
        server.url.href,
        entry,
      );
      expect(producer.stderr).toBe("");
      expect(producer.exit).toBe(0);
      const db = new Database(join(root, "transport/state.sqlite"), {
        readonly: true,
      });
      const o = JSON.parse(
        db
          .query<{ options: string }, []>(
            "SELECT options FROM acquisition_options",
          )
          .get()!.options,
      );
      expect(o.format).toBe(
        entry === old ? "socrata-v2-datahub" : "socrata-v3-catalog-decision",
      );
      db.close();
      const before = state(root),
        n = f.calls.length;
      const verified = await native(
        ["verify", "--archive", root, "--json"],
        server.url.href,
      );
      expect(verified.stderr).toBe("");
      expect(verified.exit).toBe(0);
      expect(f.calls.length).toBe(n);
      expect(state(root)).toEqual(before);
    } finally {
      server.stop(true);
    }
  }
  const s = catalogService('{"results":[],"resultSetSize":0}'),
    root = mkdtempSync(join(base, "old-negative-"));
  try {
    expect(
      (
        await native(
          ["inspect", "5uaf-hku2", "--archive", root],
          s.server.url.href,
          old,
        )
      ).exit,
    ).toBe(1);
    await rejectsUnchanged(root, s.server.url.href, s.calls, "unknown");
  } finally {
    s.server.stop(true);
  }
});

test("native interrupted catalog stream and SIGKILL remain held without HTTP or state repair", async () => {
  for (const killed of [false, true]) {
    let received: () => void = () => {};
    const seen = new Promise<void>((resolve) => {
      received = resolve;
    });
    const calls: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = req.headers.get("x-fixture-source")!;
        calls.push(url);
        if (new URL(url).pathname === "/robots.txt")
          return new Response("User-agent: *\nAllow: /\n");
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"results":['));
              received();
              if (!killed)
                setTimeout(
                  () => c.error(Error("authored interrupted body")),
                  20,
                );
            },
          }),
        );
      },
    });
    const root = mkdtempSync(join(base, "interrupted-catalog-"));
    try {
      if (killed) {
        const child = Bun.spawn(
          [
            process.execPath,
            "--preload",
            resolve(import.meta.dir, "support/native-preload.ts"),
            cli,
            "inspect",
            "5uaf-hku2",
            "--archive",
            root,
          ],
          {
            cwd: base,
            env: { ...Bun.env, SOCRATA_FIXTURE_ORIGIN: server.url.href },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        await Promise.race([
          seen,
          Bun.sleep(2000).then(() => {
            throw Error("catalog not dispatched");
          }),
        ]);
        await Bun.sleep(30);
        child.kill("SIGKILL");
        expect(await child.exited).not.toBe(0);
      } else {
        expect(
          (
            await native(
              ["inspect", "5uaf-hku2", "--archive", root],
              server.url.href,
            )
          ).exit,
        ).toBe(1);
      }
      expect(calls.length).toBe(2);
      await rejectsUnchanged(
        root,
        server.url.href,
        calls,
        killed ? "locked" : "unknown",
      );
    } finally {
      server.stop(true);
    }
  }
});
