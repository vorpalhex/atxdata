import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, cp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Archive } from "../src/archive";

const temp = () => mkdtemp(join(process.env.TMPDIR!, "gate-obligation-"));
function snapshot(db: Database) {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return JSON.stringify(
    tables.map(({ name }) => [
      name,
      db.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ]),
  );
}
test("G1 retained Retry-After60 survives controlled-clock reopen; gate-only rollback rejects without repair or traffic", async () => {
  const seed = await temp();
  let clock = 100000;
  const calls: number[] = [];
  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetch: async () => {
      calls.push(clock);
      return new Response("authored", { headers: { "Retry-After": "60" } });
    },
  };
  let a = await Archive.open(seed, deps);
  a.store.source("gate", "Gate", "https://example.invalid/data");
  a.setSpacing(3000);
  const run = a.store.start("gate", "collect");
  a.store.saveOptions(run, { budget: { requests: 5, retries: 0 } });
  await a.request(run, "first", "https://example.invalid/data", "text");
  expect(clock).toBe(103000);
  expect(a.store.notBefore()).toBe(163000);
  await a.close();
  const control = await temp(),
    fault = await temp();
  await cp(seed, control, { recursive: true });
  await cp(seed, fault, { recursive: true });
  clock = 103000;
  a = await Archive.open(control, deps);
  a.setSpacing(3000);
  const next = a.store.start("gate", "collect");
  await a.request(next, "next", "https://example.invalid/next", "text");
  expect(calls.at(-1)).toBe(163000);
  await a.close();
  const db = new Database(join(fault, "state.sqlite"));
  db.exec("UPDATE cooldown SET not_before=0");
  const before = snapshot(db),
    count = calls.length;
  clock = 103000;
  try {
    await expect(Archive.open(fault, deps)).rejects.toThrow(
      "cooldown obligation",
    );
    expect(snapshot(db)).toBe(before);
    expect(calls.length).toBe(count);
  } finally {
    db.close();
  }
});
test("G1 in-process gate rollback rejects read/cache/verify/spacing/new-run before state changes", async () => {
  const root = await temp();
  let clock = 100000,
    calls = 0;
  const a = await Archive.open(root, {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async () => {
      calls++;
      return new Response("fixture", { headers: { "Retry-After": "60" } });
    },
  });
  try {
    a.store.source("gate", "Gate", "https://example.invalid");
    a.setSpacing(3000);
    const run = a.store.start("gate", "collect");
    await a.request(run, "first", "https://example.invalid", "text");
    a.store.db.exec("UPDATE cooldown SET not_before=0");
    const before = snapshot(a.store.db),
      count = calls;
    for (const action of [
      () => a.read(run, "first"),
      () => a.request(run, "first", "https://example.invalid", "text"),
      () => a.verify(),
    ])
      await expect(action()).rejects.toThrow("cooldown obligation");
    for (const action of [
      () => a.setSpacing(3000),
      () => a.store.defer(200000),
      () => a.store.start("gate", "collect"),
      () => a.store.source("other", "Other", "https://example.invalid"),
    ])
      expect(action).toThrow("cooldown obligation");
    expect(snapshot(a.store.db)).toBe(before);
    expect(calls).toBe(count);
  } finally {
    await a.close();
  }
});

test("independent provider clock facts reject observation/version plus gate co-tamper2077", async () => {
  const root = await temp();
  let clock = 100000,
    calls = 0;
  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetch: async () => {
      calls++;
      return new Response("fixture", { headers: { "Retry-After": "60" } });
    },
  };
  const a = await Archive.open(root, deps);
  try {
    a.store.source("gate", "Gate", "https://example.invalid");
    a.setSpacing(3000);
    const run = a.store.start("gate", "collect");
    await a.request(run, "first", "https://example.invalid", "text");
    expect((await a.verify()).files).toBe(1);
    const facts = a.store.db
      .query("SELECT phase,domain,clock_ms,wall_ms FROM timing_events")
      .all() as any[];
    expect(facts.find((f) => f.phase === "complete").clock_ms).toBe(103000);
    expect(facts.find((f) => f.phase === "complete").domain).toBe(
      "injected-epoch-ms",
    );
    expect(
      Date.parse(
        (a.store.db.query("SELECT started FROM attempts").get() as any).started,
      ),
    ).toBe(facts.find((f) => f.phase === "reserve").wall_ms);
    const future = "2077-01-01T00:00:00.000Z";
    a.store.db.query("UPDATE observations SET retrieved=?").run(future);
    a.store.db.query("UPDATE versions SET first_retrieved=?").run(future);
    a.store.db
      .query("UPDATE cooldown SET not_before=?")
      .run(Date.parse(future) + 60000);
    const before = snapshot(a.store.db),
      count = calls;
    await expect(a.verify()).rejects.toThrow("checkpoint timing");
    await expect(a.read(run, "first")).rejects.toThrow("checkpoint timing");
    expect(snapshot(a.store.db)).toBe(before);
    expect(calls).toBe(count);
  } finally {
    await a.close();
  }
  await expect(Archive.open(root, deps)).rejects.toThrow("checkpoint timing");
});

test("completion-based minimum and stricter robots spacing survive reopen independently of the gate", async () => {
  const root = await temp();
  let clock = 100000;
  const starts: number[] = [];
  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetch: async () => {
      starts.push(clock);
      return new Response(
        new ReadableStream(
          {
            pull(c) {
              clock += 7000;
              c.enqueue(new TextEncoder().encode("fixture"));
              c.close();
            },
          },
          { highWaterMark: 0 },
        ),
      );
    },
  };
  let a = await Archive.open(root, deps);
  a.store.source("gate", "Gate", "https://example.invalid");
  a.setSpacing(9000);
  let run = a.store.start("gate", "collect");
  await a.request(run, "first", "https://example.invalid", "text");
  const complete = clock,
    required = complete + 9000;
  expect(a.store.notBefore()).toBe(required);
  await a.close();
  a = await Archive.open(root, deps);
  run = a.store.start("gate", "collect");
  await a.request(run, "next", "https://example.invalid", "text");
  expect(starts.at(-1)).toBe(required);
  expect(a.store.notBefore()).toBe(clock + 9000);
  await a.close();
});
test("retained rate-limit/date obligations reject rollback, and manual stop cannot be erased numerically", async () => {
  for (const headers of [
    { "RateLimit-Remaining": "0", "RateLimit-Reset": "60" },
    { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "163" },
    { RateLimit: '"quota";r=0;t=60' },
    {
      Date: new Date(100000).toUTCString(),
      "Retry-After": new Date(160000).toUTCString(),
    },
  ] as Record<string, string>[]) {
    let clock = 100000,
      calls = 0;
    const a = await Archive.open(await temp(), {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetch: async () => {
        calls++;
        return new Response("fixture", { headers });
      },
    });
    try {
      a.store.source("gate", "Gate", "https://example.invalid");
      a.setSpacing(3000);
      const run = a.store.start("gate", "collect");
      await a.request(run, "first", "https://example.invalid", "text");
      expect(a.store.notBefore()).toBe(163000);
      a.store.db.exec("UPDATE cooldown SET not_before=106000");
      const before = snapshot(a.store.db);
      await expect(
        a.request(run, "next", "https://example.invalid", "text"),
      ).rejects.toThrow("cooldown obligation");
      expect(snapshot(a.store.db)).toBe(before);
      expect(calls).toBe(1);
    } finally {
      await a.close();
    }
  }
  const a = await Archive.open(await temp());
  try {
    a.store.defer(Number.MAX_SAFE_INTEGER);
    a.store.db.exec("UPDATE cooldown SET not_before=0");
    const before = snapshot(a.store.db);
    expect(() => a.store.defer(1000)).toThrow("cooldown obligation");
    expect(snapshot(a.store.db)).toBe(before);
  } finally {
    await a.close();
  }
});
test("legacy archives without independent timing facts remain unchanged and require review", async () => {
  const root = await temp();
  let clock = 100000;
  const deps = {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetch: async () => new Response("legacy fixture"),
  };
  const a = await Archive.open(root, deps);
  a.store.source("gate", "Gate", "https://example.invalid");
  const run = a.store.start("gate", "collect");
  await a.request(run, "first", "https://example.invalid", "text");
  await a.close();
  const db = new Database(join(root, "state.sqlite"));
  db.exec("DROP TABLE timing_events");
  const before = snapshot(db);
  try {
    await expect(Archive.open(root, deps)).rejects.toThrow(
      "legacy timing evidence unavailable: operator review required",
    );
    expect(snapshot(db)).toBe(before);
  } finally {
    db.close();
  }
});
test("offline facts do not depend on reader clock, but a new operation cannot silently switch domains", async () => {
  const root = await temp();
  let clock = 100000;
  const deps = {
    now: () => clock,
    clockDomain: "controlled-clock",
    sleep: async (ms: number) => {
      clock += ms;
    },
    fetch: async () => new Response("fixture"),
  };
  let a = await Archive.open(root, deps);
  a.store.source("gate", "Gate", "https://example.invalid");
  const run = a.store.start("gate", "collect");
  await a.request(run, "first", "https://example.invalid", "text");
  await a.close();
  a = await Archive.open(root);
  try {
    expect((await a.verify()).files).toBe(1);
    expect(await a.read(run, "first")).toBe("fixture");
    const before = snapshot(a.store.db);
    expect(() => a.store.start("gate", "sync")).toThrow("clock domain changed");
    expect(snapshot(a.store.db)).toBe(before);
  } finally {
    await a.close();
  }
});

test("checkpoint input needs an independent clock upper bound; authored manual recovery stays supported", async () => {
  const root = await temp(),
    clock = 100000;
  const a = await Archive.open(root, {
    now: () => clock,
    fetch: async () => {
      throw Error("no acquisition in a source fixture control");
    },
  });
  try {
    a.store.source("manual", "Manual fixture", "https://example.invalid");
    const run = a.store.start("manual", "fixture");
    const body = "authored manual bytes",
      sha256 = createHash("sha256").update(body).digest("hex");
    const row = {
      run,
      label: "manual",
      url: "https://example.invalid",
      sha256,
      bytes: Buffer.byteLength(body),
      path: "manual.body",
      staged: "manual.body.pending",
      status: "pending" as const,
      kind: "text" as const,
      retrieved: new Date(clock + 1).toISOString(),
    };
    const before = snapshot(a.store.db);
    expect(() => a.store.checkpoint(row)).toThrow("independent clock bounds");
    expect(snapshot(a.store.db)).toBe(before);
    await writeFile(join(root, row.staged), body);
    a.store.checkpoint({ ...row, retrieved: new Date(clock).toISOString() });
    expect(await a.read(run, row.label)).toBe(body);
    expect((await a.verify()).files).toBe(1);
  } finally {
    await a.close();
  }
});
