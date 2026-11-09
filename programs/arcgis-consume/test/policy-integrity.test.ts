import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
import { main } from "../src/cli";
import { terms } from "../src/rules";
import { fixture, item, id } from "./support/selection-fixture";
const temp = () => mkdtemp(join(process.env.TMPDIR!, "policy-integrity-"));
const tables = [
  "cooldown",
  "sources",
  "runs",
  "acquisition_options",
  "attempts",
  "observations",
  "versions",
];
function snapshot(db: Database) {
  return JSON.stringify(
    tables.map((t) => db.query(`SELECT * FROM ${t}`).all()),
  );
}
function corrupt(db: Database, value: unknown) {
  if (value === "deleted") db.exec("DELETE FROM cooldown");
  else db.query("UPDATE cooldown SET not_before=?").run(value as any);
}
const args = (root: string, command = "collect") => [
  command,
  "--source",
  "tnr",
  "--item",
  id,
  "--layer",
  "7",
  "--page-size",
  "4",
  "--archive",
  root,
  "--terms-sha256",
  terms(item).sha256,
];
test("C1 actual source cached collect, verify and sync reject corrupt policy without any durable changes", async () => {
  for (const value of ["broken", -1, Number.MAX_SAFE_INTEGER + 1, "deleted"]) {
    const root = await temp(),
      f = fixture();
    await main(args(root), f.deps);
    const db = new Database(join(root, "state.sqlite"));
    corrupt(db, value);
    const before = snapshot(db),
      calls = f.calls;
    try {
      for (const command of ["collect", "verify", "sync"])
        await expect(
          main(
            command === "verify"
              ? ["verify", "--archive", root]
              : args(root, command),
            f.deps,
          ),
        ).rejects.toThrow("cooldown");
      expect(f.calls).toBe(calls);
      expect(snapshot(db)).toBe(before);
    } finally {
      db.close();
    }
  }
});
test("C1 generic reads, cache, recovery and every store write reject in-process policy damage", async () => {
  for (const value of ["broken", -1, Number.MAX_SAFE_INTEGER + 1, "deleted"]) {
    const f = fixture(),
      a = await Archive.open(await temp(), f.deps);
    try {
      a.store.source(
        "financial",
        "CSV provider",
        "https://example.invalid/data.csv",
      );
      const run = a.store.start("financial", "collect");
      await a.request(run, "raw", "https://example.invalid/data.csv", "file");
      const attempt = a.store.attempt(
        run,
        "reserved",
        "https://example.invalid/reserved",
        100,
      );
      const observation = a.store.observation(run, "raw")!;
      corrupt(a.store.db, value);
      const before = snapshot(a.store.db),
        calls = f.calls;
      for (const action of [
        () => a.read(run, "raw"),
        () => a.request(run, "raw", observation.url, "file"),
        () => a.request(run, "new", observation.url, "file"),
        () => a.verify(),
      ])
        await expect(action()).rejects.toThrow("cooldown");
      for (const action of [
        () => a.setSpacing(3000),
        () => a.store.defer(0),
        () => a.store.source("other", "other", "https://example.invalid"),
        () => a.store.start("financial", "collect"),
        () => a.store.saveOptions(run, { budget: { requests: 1 } }),
        () => a.store.resume(run, "financial", "collect"),
        () => a.store.finish(run, "failed"),
        () => a.store.attempt(run, "new", observation.url, 100),
        () => a.store.headers(attempt, 200, {}, 0),
        () => a.store.finishAttempt(attempt, 200, {}, 0, 0),
        () => a.store.checkpoint(observation),
        () => a.store.ready(observation),
      ])
        expect(action).toThrow("cooldown");
      expect(snapshot(a.store.db)).toBe(before);
      expect(f.calls).toBe(calls);
    } finally {
      await a.close();
    }
  }
});

test("F1 Financial persisted records ceiling is generic, retained and positively validated", async () => {
  const root = await temp(),
    f = fixture(),
    a = await Archive.open(root, f.deps);
  const budget = {
    requests: 10,
    responseBytes: 104857600,
    zipBytes: 104857600,
    totalBytes: 209715200,
    records: 1000000,
    retries: 0,
  };
  let run: string;
  try {
    a.store.source(
      "financial",
      "financial CSV",
      "https://example.invalid/data.csv",
    );
    run = a.store.start("financial", "collect");
    a.store.saveOptions(run, { budget });
    await a.request(run, "raw", "https://example.invalid/data.csv", "file");
    expect(a.store.options(run)?.budget.records).toBe(1000000);
    const before = snapshot(a.store.db);
    for (const records of [
      0,
      -1,
      1.5,
      Infinity,
      NaN,
      "100",
      null,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() =>
        a.store.saveOptions(run, { budget: { ...budget, records } }),
      ).toThrow("budget records");
    expect(snapshot(a.store.db)).toBe(before);
  } finally {
    await a.close();
  }
  const reopened = await Archive.open(root, f.deps);
  try {
    const calls = f.calls;
    await reopened.read(run!, "raw");
    await reopened.verify();
    await reopened.request(
      run!,
      "raw",
      "https://example.invalid/data.csv",
      "file",
    );
    expect(f.calls).toBe(calls);
    expect(reopened.store.options(run!)?.budget).toEqual(budget);
  } finally {
    await reopened.close();
  }
});

test("cooldown singleton and safe defer inputs cannot be repaired by a writer", async () => {
  const a = await Archive.open(await temp());
  try {
    a.store.defer(100);
    const before = snapshot(a.store.db);
    for (const value of [
      -1,
      0.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
      "10",
    ])
      expect(() => a.store.defer(value as any)).toThrow("cooldown");
    expect(snapshot(a.store.db)).toBe(before);
    a.store.defer(0);
    expect(a.store.notBefore()).toBe(100);
    a.store.db.exec(
      "PRAGMA ignore_check_constraints=ON; INSERT INTO cooldown VALUES(2,0)",
    );
    const extra = snapshot(a.store.db);
    expect(() => a.store.defer(200)).toThrow("singleton");
    await expect(a.verify()).rejects.toThrow("singleton");
    expect(snapshot(a.store.db)).toBe(extra);
  } finally {
    await a.close();
  }
});
test("manual review sentinel remains durable and stops source/cache/recovery before mutations", async () => {
  const root = await temp(),
    f = fixture();
  await main(args(root), f.deps);
  let a = await Archive.open(root, f.deps);
  a.store.defer(Number.MAX_SAFE_INTEGER);
  a.store.defer(0);
  expect(a.store.notBefore()).toBe(Number.MAX_SAFE_INTEGER);
  await a.close();
  const db = new Database(join(root, "state.sqlite")),
    before = snapshot(db),
    calls = f.calls;
  try {
    for (const command of ["collect", "sync", "verify"])
      await expect(
        main(
          command === "verify"
            ? ["verify", "--archive", root]
            : args(root, command),
          f.deps,
        ),
      ).rejects.toThrow("manual review");
    expect(snapshot(db)).toBe(before);
    expect(f.calls).toBe(calls);
  } finally {
    db.close();
  }
  a = await Archive.open(root, f.deps);
  try {
    expect(a.store.notBefore()).toBe(Number.MAX_SAFE_INTEGER);
  } finally {
    await a.close();
  }
});
test("retry jitter produces a conservative integral cooldown and preserves successful settlement", async () => {
  let clock = 0,
    calls = 0;
  const a = await Archive.open(await temp(), {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    random: () => 1 / 3,
    fetch: async () =>
      ++calls < 3 ? new Response("busy", { status: 503 }) : new Response("csv"),
  });
  try {
    a.store.source("csv", "CSV", "https://example.invalid/data");
    const run = a.store.start("csv", "collect");
    expect(
      Buffer.from(
        (await a.request(
          run,
          "raw",
          "https://example.invalid/data",
          "file",
        )) as Uint8Array,
      ).toString(),
    ).toBe("csv");
    expect(calls).toBe(3);
    expect(Number.isSafeInteger(a.store.notBefore())).toBe(true);
  } finally {
    await a.close();
  }
});

test("malformed server cooldown preserves deliberate stop and finalizes only its existing attempt", async () => {
  let calls = 0,
    cancelled = 0,
    clock = 0;
  const a = await Archive.open(await temp(), {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "Retry-After": "broken" } },
      );
    },
  });
  try {
    a.store.source("csv", "CSV", "https://example.invalid/data");
    const run = a.store.start("csv", "collect");
    await expect(
      a.request(run, "raw", "https://example.invalid/data", "file"),
    ).rejects.toThrow("cooldown");
    expect(a.store.notBefore()).toBe(Number.MAX_SAFE_INTEGER);
    expect(cancelled).toBe(1);
    const attempts = a.store.db
      .query("SELECT finished FROM attempts")
      .all() as any[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].finished).toBeString();
    const before = snapshot(a.store.db);
    await expect(
      a.request(run, "again", "https://example.invalid/data", "file"),
    ).rejects.toThrow("manual review");
    expect(snapshot(a.store.db)).toBe(before);
    expect(calls).toBe(1);
  } finally {
    await a.close();
  }
});

test("Financial mode0600 empty-file preallocation initializes only without prior archive evidence", async () => {
  const root = await temp();
  await writeFile(join(root, "state.sqlite"), "", { flag: "wx", mode: 0o600 });
  const a = await Archive.open(root);
  try {
    expect(a.store.notBefore()).toBe(0);
    a.store.source("financial", "CSV", "https://example.invalid");
  } finally {
    await a.close();
  }
  const damaged = await temp();
  await writeFile(join(damaged, "state.sqlite"), "");
  await writeFile(join(damaged, "retained.body"), "retained evidence");
  await expect(Archive.open(damaged)).rejects.toThrow("cooldown");
  const dbroot = await temp(),
    db = new Database(join(dbroot, "state.sqlite"));
  db.exec("CREATE TABLE sources(id TEXT)");
  db.close();
  await expect(Archive.open(dbroot)).rejects.toThrow("cooldown");
});
