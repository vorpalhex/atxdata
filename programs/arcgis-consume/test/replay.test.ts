import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";

test("repeated native replay subprocess exits agree with durable status and original hashes without retries or detached errors", async () => {
  for (let i = 0; i < 3; i++) {
    const root = await mkdtemp(
      join(process.env.TMPDIR!, "arcgis-native-replay-"),
    );
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "native-replay.ts"), root],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    // Failed subprocess artifacts remain available for diagnosis.
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    const receipt = JSON.parse(stdout);
    const db = new Database(join(root, "state.sqlite"), { readonly: true });
    try {
      expect(
        db.query("SELECT status,COUNT(*) n FROM runs GROUP BY status").all(),
      ).toEqual([{ status: "succeeded", n: 20 }]);
      expect(db.query("SELECT COUNT(*) n FROM attempts").get()).toEqual({
        n: 20,
      });
      const rows = db
        .query<
          { path: string; sha256: string; bytes: number; status: string },
          []
        >("SELECT path,sha256,bytes,status FROM observations")
        .all();
      expect(rows.length).toBe(20);
      for (const row of rows) {
        const raw = await readFile(join(root, row.path));
        expect({
          sha256: row.sha256,
          bytes: row.bytes,
          status: row.status,
        }).toEqual({
          sha256: receipt.sha256,
          bytes: receipt.bytes,
          status: "ready",
        });
        expect(raw.length).toBe(receipt.bytes);
        expect(createHash("sha256").update(raw).digest("hex")).toBe(
          receipt.sha256,
        );
      }
    } finally {
      db.close();
    }
    await rm(root, { recursive: true });
  }
}, 30000);
