import { mkdir, symlink } from "node:fs/promises";
import { test, expect } from "bun:test";
import {
  mkdtemp,
  copyFile,
  readdir,
  readFile,
  writeFile,
  chmod,
  lstat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { Archive } from "../src/archive";
import { readOnlyAppPreflight } from "../src/app-preopen";
async function files(root: string) {
  const out: Record<string, string> = {};
  for (const n of (await readdir(root)).sort()) {
    const raw = await readFile(join(root, n));
    out[n] =
      String((await lstat(join(root, n))).mode) +
      ":" +
      createHash("sha256").update(raw).digest("hex");
  }
  return out;
}
test("readonly pre-open sees hold committed only in WAL without writing", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "preopen-wal-"));
  const a = await Archive.open(root);
  await a.close();
  Bun.gc(true);
  const db = new Database(join(root, "state.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
  db.query("UPDATE cooldown SET not_before=?").run(Number.MAX_SAFE_INTEGER);
  try {
    const before = await files(root);
    await expect(readOnlyAppPreflight(root, true)).rejects.toThrow(
      "manual review",
    );
    expect(await files(root)).toEqual(before);
  } finally {
    db.close();
  }
});
test.skipIf(!process.env.ARCGIS_HELD_COPY)(
  "named old held v1 COPY refuses before native Archive.open or fetch unchanged",
  async () => {
    const input = process.env.ARCGIS_HELD_COPY;
    expect(input).toBeTruthy();
    const root = await mkdtemp(join(process.env.TMPDIR!, "old-held-copy-"));
    for (const n of await readdir(input!))
      await copyFile(join(input!, n), join(root, n));
    const fence = join(
      root,
      "..",
      "writer-fence-" + root.split("/").pop() + ".ts",
    );
    await writeFile(
      fence,
      `import {Archive} from ${JSON.stringify(resolve(import.meta.dir, "../src/archive.ts"))};Archive.open=async()=>{throw Error("WRITER_BOUNDARY_REACHED")};globalThis.fetch=async()=>{throw Error("FETCH_BOUNDARY_REACHED")};`,
    );
    const before = await files(root);
    for (const v2 of [false, true]) {
      const args = [
        "inspect-app",
        "--source",
        "austin",
        "--item",
        "9".repeat(32),
        "--archive",
        root,
        "--terms-sha256",
        "a".repeat(64),
        "--catalog-terms-sha256",
        "b".repeat(64),
        ...(v2 ? ["--app-data-format", "json-or-empty-v2"] : []),
      ];
      const p = Bun.spawn(
        [
          process.execPath,
          "--preload",
          fence,
          resolve(import.meta.dir, "../src/cli.ts"),
          ...args,
        ],
        {
          env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const out = await new Response(p.stdout).text(),
        err = await new Response(p.stderr).text();
      expect(await p.exited).toBe(1);
      expect(out).toBe("");
      expect(err).toContain("manual review");
      expect(err).not.toContain("BOUNDARY_REACHED");
      expect(await files(root)).toEqual(before);
    }
  },
);

test("readonly pre-open rejects symlink ancestors before reading archive state", async () => {
  const base = await mkdtemp(join(process.env.TMPDIR!, "preopen-alias-")),
    real = join(base, "real"),
    alias = join(base, "alias");
  await mkdir(real);
  await symlink(real, alias);
  await expect(readOnlyAppPreflight(alias, true)).rejects.toThrow("symlink");
});
test("readonly pre-open enforces outside-source scope itself", async () => {
  await expect(
    readOnlyAppPreflight(resolve(import.meta.dir, "../../.."), true),
  ).rejects.toThrow("outside source");
});
