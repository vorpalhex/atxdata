import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { policyFixture } from "./support/policy-fixture";
import { Archive } from "../src/archive";
import { inspectPolicy } from "../src/policy-inspection";
import { parseArgs } from "../src/cli";
function tables(db: Database) {
  return db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all()
    .map(({ name }) => [
      name,
      db
        .query(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)
        .all(),
    ]);
}
async function files(root: string) {
  const out: Record<string, Buffer> = {};
  for (const n of (await readdir(root)).sort())
    out[n] = await readFile(join(root, n));
  return out;
}
async function damage(root: string, label: string) {
  const db = new Database(join(root, "state.sqlite"));
  const row = db
    .query<{ path: string }, [string]>(
      "SELECT path FROM observations WHERE label=?",
    )
    .get(label)!;
  db.close();
  await writeFile(join(root, row.path), "corrupt prerequisite");
}
for (const label of [
  "unchanged",
  "catalog",
  "site-item",
  "site-data",
  "robots-www.arcgis.com",
  "app-item",
])
  test(`direct source closure ${label}`, async () => {
    const f = await policyFixture();
    let a: Archive | undefined;
    try {
      const args = await f.produce();
      expect(f.wire.length).toBe(6);
      if (label !== "unchanged") await damage(f.root, label);
      let calls = 0;
      a = await Archive.open(f.root, {
        fetch: async () => {
          calls++;
          const text = "User-agent: *\nAllow: /\n";
          return new Response(text, {
            headers: {
              "content-type": "text/plain",
              "content-length": String(text.length),
            },
          });
        },
      });
      const before = tables(a.store.db);
      let error: unknown, result: unknown;
      try {
        result = await inspectPolicy(a, parseArgs(args).policy!);
      } catch (e) {
        error = e;
      }
      if (label === "unchanged") {
        expect(error).toBeUndefined();
        expect(calls).toBe(1);
        expect(result).toMatchObject({
          summary: { permission: false, navigation: false },
        });
      } else {
        expect(String(error)).toMatch(/checksum|binding|catalog|observation/);
        expect(calls).toBe(0);
        expect(tables(a.store.db)).toEqual(before);
      }
    } finally {
      await a?.close();
      f.close();
    }
  }, 15000);
for (const label of [
  "unchanged",
  "catalog",
  "site-item",
  "site-data",
  "robots-www.arcgis.com",
])
  test(`native source closure writer fence ${label}`, async () => {
    const f = await policyFixture();
    try {
      const args = await f.produce();
      if (label !== "unchanged") await damage(f.root, label);
      const fence = join(f.base, "writer-fence.ts");
      await writeFile(
        fence,
        `import {Archive} from ${JSON.stringify(join(import.meta.dir, "../src/archive.ts"))};Archive.open=async()=>{throw Error("WRITER_FENCE")};globalThis.fetch=()=>{throw Error("FETCH_FENCE")};`,
      );
      const before = await files(f.root);
      const child = Bun.spawn(
        [
          process.execPath,
          "--preload",
          fence,
          join(import.meta.dir, "../src/cli.ts"),
          ...args,
        ],
        { env: process.env, stdout: "pipe", stderr: "pipe" },
      );
      const [out, err, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit).toBe(1);
      if (label === "unchanged") expect(err).toContain("WRITER_FENCE");
      else {
        expect(err).not.toContain("WRITER_FENCE");
        expect(err).toMatch(/checksum|catalog|observation/);
      }
      expect(err).not.toContain("FETCH_FENCE");
      expect(f.wire.length).toBe(6);
      expect(await files(f.root)).toEqual(before);
    } finally {
      f.close();
    }
  }, 15000);
