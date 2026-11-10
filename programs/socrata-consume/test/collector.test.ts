import { test, expect } from "bun:test";
import { mkdtemp, readFile, chmod, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { collect, inspect, discover, status, verify } from "../src/collector";
import { origin, catalogOrigin } from "../src/source";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");
const root = () => mkdtemp(join(base, "collector-"));
import { fixture } from "./support/fixture";
const options = (root: string) => ({
  root,
  asset: "8c6z-qnmj",
  where: "fiscal_year = '2025'",
  maxRows: 10,
  pageSize: 2,
});

test("complete bounded filtered selection, SQLite original rows, offline reuse, refresh version retention", async () => {
  const dir = await root(),
    f = fixture();
  const first = await collect(options(dir), f.deps);
  expect(first).toMatchObject({
    status: "complete",
    rows: 3,
    sourceCount: "3",
    wholeAsset: false,
    reused: false,
  });
  const count = f.calls.length;
  expect(await verify(dir)).toMatchObject({
    snapshots: 1,
    rows: 3,
    httpRequests: 0,
  });
  expect(await collect(options(dir), f.deps)).toMatchObject({
    reused: true,
    rows: 3,
  });
  expect(f.calls.length).toBe(count);
  const db = new Database(join(dir, "data.sqlite"), { readonly: true });
  const row = db
    .query<{ source_id: string; source_json: string; value_json: string }, []>(
      "SELECT * FROM source_rows ORDER BY ordinal LIMIT 1",
    )
    .get()!;
  expect(row.source_id).toBe("row-1");
  expect(JSON.parse(row.source_json).amount).toBe("9007199254740993.00");
  expect(JSON.parse(row.value_json).amount).toBe("9007199254740993.00");
  db.close();
  f.change();
  await collect({ ...options(dir), refresh: true }, f.deps);
  expect(await status(dir)).toMatchObject({ snapshots: 2, complete: 2 });
  expect(await verify(dir)).toMatchObject({ snapshots: 2, rows: 6 });
});

test("429 retains partial and resumes without re-fetching retained pages; pacing survives reopen", async () => {
  const dir = await root(),
    f = fixture();
  f.fail(2);
  await expect(collect(options(dir), f.deps)).rejects.toThrow("429");
  const before = f.calls.length;
  const result = await collect({ ...options(dir), resume: true }, f.deps);
  expect(result.rows).toBe(3);
  const pages = f.calls
    .slice(before)
    .filter((u) => new URL(u).searchParams.has("$offset"));
  expect(
    pages.every((u) => new URL(u).searchParams.get("$offset") !== "0"),
  ).toBe(true);
  expect(await verify(dir)).toMatchObject({ snapshots: 1, rows: 3 });
});

test("selected count over ceiling rejects before resource pages and never claims prefix complete", async () => {
  const dir = await root(),
    f = fixture();
  await expect(
    collect({ ...options(dir), maxRows: 2 }, f.deps),
  ).rejects.toThrow("count exceeds");
  expect(f.calls.some((u) => new URL(u).searchParams.has("$offset"))).toBe(
    false,
  );
  expect((await status(dir)).complete).toBe(0);
});

test("changed source cannot resume an old traversal; explicit refresh retains old version", async () => {
  const dir = await root(),
    f = fixture();
  f.fail(2);
  await expect(collect(options(dir), f.deps)).rejects.toThrow();
  f.change();
  await expect(
    collect({ ...options(dir), resume: true }, f.deps),
  ).rejects.toThrow("source changed");
  await collect({ ...options(dir), refresh: true }, f.deps);
  expect((await status(dir)).snapshots).toBe(2);
});

test("discover and inspect are generic catalog-backed paths, not row acquisition", async () => {
  const dir = await root(),
    f = fixture();
  expect(
    await discover({ root: dir, query: "payments", limit: 5 }, f.deps),
  ).toMatchObject({ total: "1", assets: [{ id: "8c6z-qnmj" }] });
  expect(
    await inspect({ root: dir, asset: "8c6z-qnmj" }, f.deps),
  ).toMatchObject({ id: "8c6z-qnmj", columns: [{ fieldName: "amount" }] });
  expect(f.calls.some((u) => new URL(u).pathname.startsWith("/resource"))).toBe(
    false,
  );
});

test("corrupt row derivation rejects offline and before reuse transport without repair", async () => {
  const dir = await root(),
    f = fixture();
  await collect(options(dir), f.deps);
  const db = new Database(join(dir, "data.sqlite"));
  db.exec("UPDATE source_rows SET source_id='forged' WHERE ordinal=0");
  db.close();
  const count = f.calls.length;
  await expect(verify(dir)).rejects.toThrow("row");
  await expect(collect(options(dir), f.deps)).rejects.toThrow("row");
  expect(f.calls.length).toBe(count);
});

test("invalid target, absent bounds, unsupported preset and symlink root fail before output or transport", async () => {
  const dir = await root(),
    f = fixture();
  for (const bad of [
    { asset: "../bad" },
    { asset: "8c6z-qnmj", maxRows: 0 },
    { preset: "unknown" },
  ])
    await expect(
      collect({ root: join(dir, "absent"), ...bad } as any, f.deps),
    ).rejects.toThrow();
  expect(f.calls.length).toBe(0);
  const link = join(dir, "link");
  await symlink(join(dir, "absent"), link);
  await expect(collect({ ...options(link) }, f.deps)).rejects.toThrow(
    "symlink",
  );
});

test("reuse enforces current row and per-response bounds without hidden traffic", async () => {
  const dir = await root(),
    f = fixture();
  await collect(options(dir), f.deps);
  const count = f.calls.length;
  await expect(
    collect({ ...options(dir), maxRows: 2 }, f.deps),
  ).rejects.toThrow("reuse exceeds");
  await expect(
    collect({ ...options(dir), budget: { responseBytes: 1 } }, f.deps),
  ).rejects.toThrow("reuse exceeds");
  expect(
    await collect({ ...options(dir), maxRows: 100, pageSize: 1 }, f.deps),
  ).toMatchObject({ reused: true, rows: 3 });
  expect(f.calls.length).toBe(count);
});

test("partial selection cannot be hidden behind a different caller budget or page size", async () => {
  const dir = await root(),
    f = fixture();
  f.fail(2);
  await expect(collect(options(dir), f.deps)).rejects.toThrow("429");
  const count = f.calls.length;
  await expect(
    collect(
      { ...options(dir), maxRows: 100, pageSize: 1, resume: true },
      f.deps,
    ),
  ).rejects.toThrow("resume selection");
  expect(f.calls.length).toBe(count);
});

test("server-side smaller page caps advance by actual rows and require an empty terminal page", async () => {
  const dir = await root(),
    f = fixture();
  const fetch = f.deps.fetch;
  const deps = {
    ...f.deps,
    fetch: async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.has("$offset")) u.searchParams.set("$limit", "1");
      return fetch(u.href);
    },
  };
  const result = await collect(options(dir), deps);
  expect(result.rows).toBe(3);
  expect(result.status).toBe("complete");
  expect(
    f.calls
      .filter((u) => new URL(u).searchParams.has("$offset"))
      .map((u) => new URL(u).searchParams.get("$offset")),
  ).toEqual(["0", "1", "2", "3"]);
  expect(await verify(dir)).toMatchObject({ rows: 3 });
});

test("ignored offsets and duplicate page IDs cannot become a complete traversal", async () => {
  const dir = await root(),
    f = fixture(),
    fetch = f.deps.fetch;
  const deps = {
    ...f.deps,
    fetch: async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.has("$offset")) u.searchParams.set("$offset", "0");
      return fetch(u.href);
    },
  };
  await expect(collect(options(dir), deps)).rejects.toThrow();
  expect((await status(dir)).complete).toBe(0);
});
