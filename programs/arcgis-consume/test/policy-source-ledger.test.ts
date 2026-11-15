import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { policyFixture } from "./support/policy-fixture";
import { Archive } from "../src/archive";
import { ReadonlyAppEvidence } from "../src/app-readonly";
import { withReadOnlyArchive } from "../src/app-preopen";
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
// Authored coherent corruption: do not let a timing mismatch mask source checks.
function bindFixtureTiming(db: Database, label: string) {
  const a = db
    .query<
      { id: string; status: number; headers: string; bytes: number },
      [string]
    >("SELECT id,status,headers,bytes FROM attempts WHERE label=?")
    .get(label)!;
  const o = db
    .query<{ sha256: string; bytes: number }, [string]>(
      "SELECT sha256,bytes FROM observations WHERE label=?",
    )
    .get(label)!;
  for (const event of db
    .query<{ id: string; phase: string; detail: string }, [string]>(
      "SELECT id,phase,detail FROM timing_events WHERE attempt=?",
    )
    .all(a.id)) {
    const detail = JSON.parse(event.detail);
    if (event.phase === "headers" || event.phase === "complete") {
      detail.status = a.status;
      detail.headers = JSON.parse(a.headers);
    }
    if (event.phase === "complete") detail.bytes = a.bytes;
    if (event.phase === "checkpoint") {
      const update = (value: Record<string, unknown>) => {
        for (const [key, child] of Object.entries(value)) {
          if (key === "sha256") value[key] = o.sha256;
          else if (key === "bytes") value[key] = o.bytes;
          else if (
            child !== null &&
            typeof child === "object" &&
            !Array.isArray(child)
          )
            update(child as Record<string, unknown>);
        }
      };
      update(detail);
    }
    db.query("UPDATE timing_events SET detail=? WHERE id=?").run(
      JSON.stringify(detail),
      event.id,
    );
  }
}
async function rewrite(root: string, db: Database, label: string, raw: string) {
  const o = db
    .query<{ run: string; path: string }, [string]>(
      "SELECT run,path FROM observations WHERE label=?",
    )
    .get(label)!;
  const sha = createHash("sha256").update(raw).digest("hex"),
    bytes = Buffer.byteLength(raw);
  await writeFile(join(root, o.path), raw);
  db.query(
    "UPDATE observations SET sha256=?,bytes=? WHERE run=? AND label=?",
  ).run(sha, bytes, o.run, label);
  db.query("UPDATE versions SET sha256=?,bytes=? WHERE path=?").run(
    sha,
    bytes,
    o.path,
  );
  const a = db
    .query<{ headers: string }, [string]>(
      "SELECT headers FROM attempts WHERE id=?",
    )
    .get(o.path.slice(0, -5))!;
  const headers = JSON.parse(a.headers);
  headers["content-length"] = String(bytes);
  db.query("UPDATE attempts SET bytes=?,headers=? WHERE id=?").run(
    bytes,
    JSON.stringify(headers),
    o.path.slice(0, -5),
  );
  const r = db
    .query<{ summary: string }, [string]>("SELECT summary FROM runs WHERE id=?")
    .get(o.run)!;
  const summary = JSON.parse(r.summary);
  for (const receipt of summary.receipts)
    if (receipt.label === label) {
      receipt.sha256 = sha;
      receipt.bytes = bytes;
    }
  db.query("UPDATE runs SET summary=? WHERE id=?").run(
    JSON.stringify(summary),
    o.run,
  );
}
for (const fault of [
  "producer",
  "history",
  "unknown-intent",
  "rehashed-catalog",
])
  test(`complete source ledger refuses ${fault} with no further mutation`, async () => {
    const f = await policyFixture();
    let a: Archive | undefined;
    try {
      const args = await f.produce(),
        db = new Database(join(f.root, "state.sqlite"));
      if (fault === "producer") {
        db.query("UPDATE attempts SET status=201 WHERE label='catalog'").run();
        bindFixtureTiming(db, "catalog");
      }
      if (fault === "history")
        db.query("DELETE FROM versions WHERE label='catalog'").run();
      if (fault === "unknown-intent") {
        const row = db
          .query<{ run: string; options: string }, []>(
            "SELECT run,options FROM acquisition_options",
          )
          .get()!;
        const options = JSON.parse(row.options);
        delete options.mode;
        db.query("UPDATE acquisition_options SET options=? WHERE run=?").run(
          JSON.stringify(options),
          row.run,
        );
      }
      if (fault === "rehashed-catalog") {
        const row = db
          .query<{ path: string }, []>(
            "SELECT path FROM observations WHERE label='catalog'",
          )
          .get()!;
        const catalog = JSON.parse(
          await readFile(join(f.root, row.path), "utf8"),
        );
        catalog.results[0].access = "private";
        await rewrite(f.root, db, "catalog", JSON.stringify(catalog));
      }
      if (fault === "rehashed-policy")
        bindFixtureTiming(db, "robots-www.arcgis.com");
      if (fault === "rehashed-catalog") bindFixtureTiming(db, "catalog");
      db.close();
      let calls = 0;
      a = await Archive.open(f.root, {
        fetch: async () => {
          calls++;
          throw Error("UNEXPECTED_TRANSPORT");
        },
      });
      const before = tables(a.store.db);
      let error = "";
      try {
        await inspectPolicy(a, parseArgs(args).policy!);
      } catch (e) {
        error = String(e);
      }
      expect(error).not.toBe("");
      expect(error).not.toContain("UNEXPECTED_TRANSPORT");
      if (fault === "producer") expect(error).toContain("producer binding");
      if (fault === "rehashed-catalog")
        expect(error).toContain("catalog member");
      expect(calls).toBe(0);
      expect(tables(a.store.db)).toEqual(before);
    } finally {
      await a?.close();
      f.close();
    }
  }, 15000);
test("late ledger change during awaited body verification cannot append policy state", async () => {
  const f = await policyFixture();
  let a: Archive | undefined;
  const original = ReadonlyAppEvidence.prototype.readExpected;
  try {
    const args = await f.produce();
    let calls = 0,
      changed = false,
      before: ReturnType<typeof tables> | undefined;
    a = await Archive.open(f.root, {
      fetch: async () => {
        calls++;
        throw Error("UNEXPECTED_TRANSPORT");
      },
    });
    ReadonlyAppEvidence.prototype.readExpected = async function (...params) {
      const result = await original.apply(this, params);
      if (params[1] === "app-data" && !changed) {
        changed = true;
        const row = this.store.db
          .query<{ run: string; options: string }, []>(
            "SELECT run,options FROM acquisition_options",
          )
          .get()!;
        const options = JSON.parse(row.options);
        options.catalogTermsSha256 = "0".repeat(64);
        this.store.db
          .query("UPDATE acquisition_options SET options=? WHERE run=?")
          .run(JSON.stringify(options), row.run);
        before = tables(this.store.db);
      }
      return result;
    };
    await expect(inspectPolicy(a, parseArgs(args).policy!)).rejects.toThrow(
      "ledger changed",
    );
    expect(changed).toBe(true);
    expect(calls).toBe(0);
    expect(tables(a.store.db)).toEqual(before!);
  } finally {
    ReadonlyAppEvidence.prototype.readExpected = original;
    await a?.close();
    f.close();
  }
}, 15000);
test("readonly native snapshot rechecks disk ledger after awaited closure", async () => {
  const f = await policyFixture();
  try {
    await f.produce();
    await expect(
      withReadOnlyArchive(
        f.root,
        async () => {
          await Promise.resolve();
          const db = new Database(join(f.root, "state.sqlite"));
          db.query("UPDATE cooldown SET not_before=?").run(
            Number.MAX_SAFE_INTEGER,
          );
          db.close();
        },
        true,
      ),
    ).rejects.toThrow("ledger changed");
  } finally {
    f.close();
  }
}, 15000);
test("readonly evidence explicitly refuses every acquisition capability", async () => {
  const f = await policyFixture();
  let a: Archive | undefined;
  try {
    const args = await f.produce();
    a = await Archive.open(f.root);
    const view = new ReadonlyAppEvidence(f.root, a.store.db);
    const before = tables(a.store.db);
    await expect(
      view.request(
        parseArgs(args).policy!.appRun,
        "fixture",
        "https://example.invalid/",
        "text",
      ),
    ).rejects.toThrow("cannot request");
    expect(() => view.store.defer(1)).toThrow("cannot defer");
    expect(() => {
      view.guard = () => {};
    }).toThrow("cannot set");
    expect(tables(a.store.db)).toEqual(before);
  } finally {
    await a?.close();
    f.close();
  }
}, 15000);
