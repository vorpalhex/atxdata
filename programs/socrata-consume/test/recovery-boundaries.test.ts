import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { collect, verify, status } from "../src/collector";
import { hash, Session } from "../src/transport";
import { fixture } from "./support/fixture";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");
const options = (root: string) => ({
  root,
  asset: "8c6z-qnmj",
  where: "fiscal_year = '2025'",
  maxRows: 3,
  pageSize: 2,
});
// Capture every logical table and all durable bytes; SHM is reader-lock bookkeeping.
export function state(root: string) {
  const logical: Record<string, unknown> = {},
    files: Record<string, string> = {};
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (name.endsWith("-shm")) continue;
      if (name.endsWith(".sqlite")) {
        const db = new Database(path, { readonly: true });
        logical[path] = Object.fromEntries(
          db
            .query<{ name: string }, []>(
              "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
            )
            .all()
            .map(({ name }) => [
              name,
              db.query(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
            ]),
        );
        db.close();
      }
      files[path] = hash(readFileSync(path));
    }
  }
  walk(root);
  return { logical, files };
}
test("explicit resumed budget and timeout conflicts reject unchanged before writer or transport", async () => {
  const root = mkdtempSync(join(base, "limits-")),
    f = fixture();
  const opts = {
    ...options(root),
    timeoutMs: 45000,
    budget: { requests: 100, responseBytes: 20000, totalBytes: 200000 },
  };
  f.fail(2);
  await expect(collect(opts, f.deps)).rejects.toThrow("429");
  const before = state(root),
    count = f.calls.length,
    open = Session.open;
  let writers = 0;
  Session.open = async (...args: Parameters<typeof open>) => {
    writers++;
    return open(...args);
  };
  try {
    for (const budget of [
      { requests: 1 },
      { requests: 101 },
      { responseBytes: 1 },
      { totalBytes: 1 },
      { records: 1 },
      { zipBytes: 1 },
    ])
      await expect(
        collect({ ...options(root), resume: true, budget }, f.deps),
      ).rejects.toThrow("resume budget");
    await expect(
      collect({ ...opts, resume: true, timeoutMs: 60000 }, f.deps),
    ).rejects.toThrow("resume timeout");
  } finally {
    Session.open = open;
  }
  expect(writers).toBe(0);
  expect(f.calls.length).toBe(count);
  expect(state(root)).toEqual(before);
  expect((await collect({ ...opts, resume: true }, f.deps)).status).toBe(
    "complete",
  );
});

test("unindexed pending next page remains recoverable without refetching its original", async () => {
  const root = mkdtempSync(join(base, "pending-page-")),
    f = fixture();
  f.fail(2);
  await expect(collect(options(root), f.deps)).rejects.toThrow("429");
  const data = new Database(join(root, "data.sqlite"));
  data.exec("DELETE FROM source_rows; DELETE FROM pages");
  data.close();
  const db = new Database(join(root, "transport", "state.sqlite"));
  const row = db
    .query<{ path: string }, []>(
      "SELECT path FROM observations WHERE label='page:0'",
    )
    .get()!;
  db.exec("UPDATE observations SET status='pending' WHERE label='page:0'");
  db.close();
  const { renameSync } = await import("node:fs");
  renameSync(
    join(root, "transport", row.path),
    join(root, "transport", row.path + ".pending"),
  );
  expect((await verify(root)).rows).toBe(0);
  const count = f.calls.length;
  expect((await collect({ ...options(root), resume: true }, f.deps)).rows).toBe(
    3,
  );
  expect(
    f.calls
      .slice(count)
      .some((u) => new URL(u).searchParams.get("$offset") === "0"),
  ).toBe(false);
  expect((await verify(root)).complete).toBe(1);
});

test("native CLI rejects each explicit conflicting ceiling and timeout with zero loopback traffic and unchanged state", async () => {
  const root = mkdtempSync(join(base, "native-limits-")),
    f = fixture();
  f.fail(2);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => f.deps.fetch(request.headers.get("x-fixture-source")!),
  });
  const argv = [
    "collect",
    "8c6z-qnmj",
    "--where",
    "fiscal_year = '2025'",
    "--max-rows",
    "3",
    "--page-size",
    "2",
    "--archive",
    root,
    "--json",
  ];
  async function run(extra: string[]) {
    const child = Bun.spawn(
      [
        process.execPath,
        "--preload",
        join(import.meta.dir, "support/native-preload.ts"),
        join(import.meta.dir, "../src/cli.ts"),
        ...argv,
        ...extra,
      ],
      {
        env: { ...Bun.env, SOCRATA_FIXTURE_ORIGIN: server.url.href },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exit };
  }
  try {
    const frozen = [
      "--max-requests",
      "100",
      "--response-bytes",
      "20000",
      "--total-bytes",
      "200000",
    ];
    expect((await run(frozen)).stderr).toContain("429");
    const before = state(root),
      count = f.calls.length;
    for (const [flag, value, error] of [
      ["--max-requests", "1", "budget"],
      ["--response-bytes", "1", "budget"],
      ["--total-bytes", "1", "budget"],
      ["--timeout-ms", "60000", "timeout"],
    ]) {
      const r = await run(["--resume", flag!, value!]);
      expect(r.exit).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain(`resume ${error}`);
      expect(state(root)).toEqual(before);
      expect(f.calls.length).toBe(count);
    }
    const resumed = await run(["--resume", ...frozen]);
    expect(resumed.exit).toBe(0);
    expect(resumed.stderr).toBe("");
    expect(JSON.parse(resumed.stdout).status).toBe("complete");
  } finally {
    server.stop(true);
  }
});

for (const damage of ["empty", "stale", "pages"] as const)
  test(`retained completed inventory rejects ${damage} derived state before writer or transport`, async () => {
    const root = mkdtempSync(join(base, "inventory-")),
      f = fixture();
    await collect(options(root), f.deps);
    if (damage === "stale")
      await collect({ ...options(root), refresh: true }, f.deps);
    const db = new Database(join(root, "data.sqlite"));
    db.exec("PRAGMA foreign_keys=ON");
    const id = (
      db
        .query("SELECT id FROM snapshots ORDER BY rowid DESC LIMIT 1")
        .get() as { id: string }
    ).id;
    db.query("DELETE FROM source_rows WHERE snapshot=?").run(id);
    db.query("DELETE FROM pages WHERE snapshot=?").run(id);
    if (damage !== "pages")
      db.query("DELETE FROM snapshots WHERE id=?").run(id);
    else db.query("UPDATE snapshots SET status='partial' WHERE id=?").run(id);
    db.close();
    const before = state(root),
      count = f.calls.length;
    const open = Session.open;
    let writers = 0;
    Session.open = async (...args: Parameters<typeof open>) => {
      writers++;
      return open(...args);
    };
    try {
      await expect(verify(root)).rejects.toThrow("inventory");
      await expect(status(root)).rejects.toThrow("inventory");
      await expect(
        collect({ ...options(root), refresh: true }, f.deps),
      ).rejects.toThrow("inventory");
    } finally {
      Session.open = open;
    }
    expect(writers).toBe(0);
    expect(f.calls.length).toBe(count);
    expect(state(root)).toEqual(before);
  });
