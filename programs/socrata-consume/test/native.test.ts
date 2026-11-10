import { test, expect } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { fixture } from "./support/fixture";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");
const cli = resolve(import.meta.dir, "../src/cli.ts"),
  preload = resolve(import.meta.dir, "support/native-preload.ts");
async function native(args: string[], endpoint: string) {
  const child = Bun.spawn(
    [process.execPath, "--preload", preload, cli, ...args],
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
function service() {
  const f = fixture(),
    violations: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (
        request.method !== "GET" ||
        request.headers.has("authorization") ||
        request.headers.has("cookie") ||
        request.headers.has("x-app-token")
      ) {
        violations.push("unsafe fixture request");
        return new Response("unsafe", { status: 400 });
      }
      return f.deps.fetch(request.headers.get("x-fixture-source")!);
    },
  });
  return { f, server, endpoint: server.url.href, violations };
}
const args = (root: string) => [
  "collect",
  "--preset",
  "echeckbook",
  "--where",
  "fiscal_year = '2025'",
  "--max-rows",
  "10",
  "--page-size",
  "2",
  "--archive",
  root,
  "--json",
];

test("shipped Commander operational path acquires native HTTP bytes then zero-wire reuse and offline verification", async () => {
  const root = await mkdtemp(join(base, "native-")),
    s = service();
  try {
    const first = await native(args(root), s.endpoint);
    expect(first.stderr).toBe("");
    expect(first.exit).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      status: "complete",
      rows: 3,
      wholeAsset: false,
    });
    const count = s.f.calls.length;
    expect(count).toBeGreaterThan(5);
    expect(
      s.f.calls.every(
        (u) => new URL(u).origin === "https://datahub.austintexas.gov",
      ),
    ).toBe(true);
    expect(
      s.f.calls.filter((u) => new URL(u).pathname === "/robots.txt").length,
    ).toBe(1);
    const reused = await native(args(root), s.endpoint);
    expect(reused.exit).toBe(0);
    expect(JSON.parse(reused.stdout).reused).toBe(true);
    const verified = await native(
      ["--archive", root, "verify", "--json"],
      s.endpoint,
    );
    expect(verified.exit).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({
      rows: 3,
      httpRequests: 0,
    });
    expect(s.f.calls.length).toBe(count);
    expect(s.violations).toEqual([]);
  } finally {
    s.server.stop(true);
  }
});

test("native resumed429 and gate rollback distinguish unchanged valid control from zero-wire no-write corruption", async () => {
  const root = await mkdtemp(join(base, "native429-")),
    s = service();
  try {
    s.f.fail(2);
    expect((await native(args(root), s.endpoint)).stderr).toContain("429");
    const resumed = await native([...args(root), "--resume"], s.endpoint);
    expect(resumed.stderr).toBe("");
    expect(resumed.exit).toBe(0);
    expect(JSON.parse(resumed.stdout).rows).toBe(3);
    const count = s.f.calls.length,
      path = join(root, "transport", "state.sqlite"),
      db = new Database(path);
    db.exec("UPDATE cooldown SET not_before=0");
    db.close();
    const before = await readFile(path);
    for (const command of [["status"], ["verify"], args(root)]) {
      const r = await native(
        command[0] === "collect"
          ? command
          : [...command, "--archive", root, "--json"],
        s.endpoint,
      );
      expect(r.exit).toBe(1);
      expect(r.stderr).toContain("rollback");
      expect(r.stdout).toBe("");
    }
    expect(s.f.calls.length).toBe(count);
    expect(await readFile(path)).toEqual(before);
  } finally {
    s.server.stop(true);
  }
});

test("native gzip response evidence is explicitly fetch-decoded, not mislabelled compressed wire originals", async () => {
  const root = await mkdtemp(join(base, "gzip-")),
    f = fixture();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const response = await f.deps.fetch(
        request.headers.get("x-fixture-source")!,
      );
      if (!response.headers.get("content-type")?.includes("application/json"))
        return response;
      const encoded = Bun.gzipSync(await response.arrayBuffer());
      return new Response(encoded, {
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "content-length": String(encoded.length),
        },
      });
    },
  });
  try {
    const r = await native(args(root), server.url.href);
    expect(r.stderr).toBe("");
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout).rows).toBe(3);
    const db = new Database(join(root, "transport", "state.sqlite"), {
      readonly: true,
    });
    const row = db
      .query<
        { path: string; bytes: number; headers: string; options: string },
        []
      >(
        "SELECT o.path,o.bytes,a.headers,p.options FROM observations o JOIN attempts a ON o.path=a.id||'.body' JOIN acquisition_options p ON p.run=o.run WHERE o.label='page:0'",
      )
      .get()!;
    db.close();
    const raw = await readFile(join(root, "transport", row.path));
    expect(raw.length).toBe(row.bytes);
    expect(Array.isArray(JSON.parse(raw.toString()))).toBe(true);
    expect(JSON.parse(row.headers)["content-encoding"]).toBe("gzip");
    expect(JSON.parse(row.options).representation).toBe("fetch-decoded-body");
  } finally {
    server.stop(true);
  }
});

test("native configured body timeout retains unknown transfer and refuses a fresh acquisition", async () => {
  const root = await mkdtemp(join(base, "timeout-"));
  let calls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("User-agent: *\n"));
          },
          cancel() {},
        }),
      );
    },
  });
  try {
    const first = await native(
      [...args(root), "--timeout-ms", "30"],
      server.url.href,
    );
    expect(first.exit).toBe(1);
    expect(first.stdout).toBe("");
    const second = await native(args(root), server.url.href);
    expect(second.exit).toBe(1);
    expect(second.stderr).toContain("unknown");
    expect(calls).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("native SIGTERM during a response preserves lock and dispatched reservation rather than silently restarting", async () => {
  const root = await mkdtemp(join(base, "terminate-"));
  let observed: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      observed();
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("User-agent: *\n"));
          },
          cancel() {},
        }),
      );
    },
  });
  const child = Bun.spawn(
    [process.execPath, "--preload", preload, cli, ...args(root)],
    {
      cwd: base,
      env: { ...Bun.env, SOCRATA_FIXTURE_ORIGIN: server.url.href },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    },
  );
  try {
    await Promise.race([
      started,
      Bun.sleep(2000).then(() => {
        throw Error("fixture did not receive producer");
      }),
    ]);
    child.kill("SIGTERM");
    expect(await child.exited).not.toBe(0);
    const db = new Database(join(root, "transport", "state.sqlite"), {
        readonly: true,
      }),
      row = db
        .query<{ finished: string | null; bytes: number }, []>(
          "SELECT finished,bytes FROM attempts",
        )
        .get()!;
    db.close();
    expect(row.finished).toBe(null);
    expect(row.bytes).toBeGreaterThan(0);
    const result = await native(
      ["verify", "--archive", root, "--json"],
      server.url.href,
    );
    expect(result.exit).toBe(1);
    expect(result.stderr).toContain("locked");
    expect(result.stdout).toBe("");
  } finally {
    child.kill();
    server.stop(true);
  }
});
