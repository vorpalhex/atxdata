import { test, expect } from "bun:test";
import {
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { collect, status, verify } from "../src/collector";
import { fixture } from "./support/fixture";
const base = (() => {
  const root = process.env.SOCRATA_TEST_ROOT;
  if (!root) throw Error("set SOCRATA_TEST_ROOT");
  return root;
})();
const options = (root: string) => ({
  root,
  asset: "8c6z-qnmj",
  where: "fiscal_year = '2025'",
  maxRows: 3,
  pageSize: 2,
});
async function produced() {
  const root = await mkdtemp(join(base, "security-")),
    f = fixture();
  await collect(options(root), f.deps);
  return { root, f };
}

test("deleted policy/timing schema rejects offline and collection without schema repair", async () => {
  for (const table of ["cooldown", "timing_events"]) {
    const { root, f } = await produced(),
      path = join(root, "transport", "state.sqlite"),
      db = new Database(path);
    db.exec(`DROP TABLE ${table}`);
    db.close();
    const before = await readFile(path),
      count = f.calls.length;
    await expect(verify(root)).rejects.toThrow(/schema|timing evidence/);
    await expect(
      collect({ ...options(root), refresh: true }, f.deps),
    ).rejects.toThrow(/schema|timing evidence/);
    expect(f.calls.length).toBe(count);
    expect(await readFile(path)).toEqual(before);
  }
});

test("versioned operation identity cannot be downgraded while reusing intact original files", async () => {
  const { root, f } = await produced(),
    path = join(root, "transport", "state.sqlite"),
    db = new Database(path);
  const row = db
    .query<{ run: string; options: string }, []>(
      "SELECT * FROM acquisition_options WHERE json_extract(options,'$.selection') IS NOT NULL",
    )
    .get()!;
  const options = JSON.parse(row.options);
  expect(options.format).toBe("socrata-v1");
  expect(options.representation).toBe("fetch-decoded-body");
  options.format = "foreign-v0";
  db.query("UPDATE acquisition_options SET options=? WHERE run=?").run(
    JSON.stringify(options),
    row.run,
  );
  db.close();
  const before = await readFile(path),
    count = f.calls.length;
  await expect(verify(root)).rejects.toThrow("operation");
  expect(f.calls.length).toBe(count);
  expect(await readFile(path)).toEqual(before);
});

test("unknown budget keys and preexisting/symlink outputs reject before source/archive writes", async () => {
  const root = await mkdtemp(join(base, "admission-")),
    f = fixture();
  await expect(
    collect(
      { ...options(join(root, "absent")), budget: { notABudget: 1 } as any },
      f.deps,
    ),
  ).rejects.toThrow("budget");
  await expect(access(join(root, "absent"))).rejects.toThrow();
  await writeFile(join(root, "sentinel"), "keep", { mode: 0o600 });
  await symlink(join(root, "sentinel"), join(root, "data.sqlite"));
  await expect(collect(options(root), f.deps)).rejects.toThrow();
  expect(f.calls.length).toBe(0);
  expect(await readFile(join(root, "sentinel"), "utf8")).toBe("keep");
});

test("offline status rejects foreign archive files and does not silently claim a different directory is valid", async () => {
  const root = await mkdtemp(join(base, "foreign-"));
  await writeFile(join(root, "unrelated"), "keep", { mode: 0o600 });
  await expect(status(root)).rejects.toThrow("unknown");
  expect(await readFile(join(root, "unrelated"), "utf8")).toBe("keep");
});

test("missing derived database cannot hide retained row acquisitions or reset coverage", async () => {
  const { root, f } = await produced(),
    { unlink } = await import("node:fs/promises");
  await unlink(join(root, "data.sqlite"));
  const count = f.calls.length;
  await expect(verify(root)).rejects.toThrow("missing source database");
  await expect(
    collect({ ...options(root), refresh: true }, f.deps),
  ).rejects.toThrow("missing source database");
  expect(f.calls.length).toBe(count);
});

test("run command identity cannot be swapped while reusing retained source bytes", async () => {
  const { root, f } = await produced(),
    path = join(root, "transport", "state.sqlite"),
    db = new Database(path);
  db.exec("UPDATE runs SET command='discover'");
  db.close();
  const count = f.calls.length;
  await expect(verify(root)).rejects.toThrow("operation");
  expect(f.calls.length).toBe(count);
});

test("retained version inventory cannot be removed while source snapshots still certify it", async () => {
  const { root, f } = await produced(),
    path = join(root, "transport", "state.sqlite"),
    db = new Database(path);
  db.exec("DELETE FROM versions WHERE rowid=(SELECT min(rowid) FROM versions)");
  db.close();
  const count = f.calls.length;
  await expect(verify(root)).rejects.toThrow("version");
  expect(f.calls.length).toBe(count);
});
