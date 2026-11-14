import { test, expect } from "bun:test";
import { mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Session } from "../src/transport";
import { origin } from "../src/source";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base)
  throw Error("set SOCRATA_TEST_ROOT to a private external fixture directory");
const root = () => mkdtemp(join(base, "transport-"));
function clock() {
  let time = 1800000000000;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    clockDomain: "fixture-epoch-ms",
  };
}

test("serial archived text keeps bare arrays and success Retry-After across reopen", async () => {
  const dir = await root(),
    time = clock(),
    starts: number[] = [];
  const deps = {
    ...time,
    fetch: async () => {
      starts.push(time.now());
      return new Response('[{"a":1}]', { headers: { "Retry-After": "10" } });
    },
  };
  let s = await Session.open(dir, deps);
  const run = s.start("fixture", { requests: 5 });
  expect(await s.request(run, "a", origin + "/api/views/8c6z-qnmj.json")).toBe(
    '[{"a":1}]',
  );
  await s.close();
  s = await Session.open(dir, deps);
  const run2 = s.start("fixture", { requests: 5 });
  await s.request(run2, "b", origin + "/api/views/8c6z-qnmj.json");
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(10000);
  await s.close();
});

test("gate-only rollback rejects without changing database or making another request", async () => {
  const dir = await root(),
    time = clock();
  let requests = 0;
  const deps = {
    ...time,
    fetch: async () => {
      requests++;
      return new Response("[]", { headers: { "Retry-After": "30" } });
    },
  };
  const s = await Session.open(dir, deps),
    run = s.start("fixture", {});
  await s.request(run, "a", origin + "/api/views/8c6z-qnmj.json");
  await s.close();
  const path = join(dir, "transport", "state.sqlite"),
    db = new Database(path);
  db.exec("UPDATE cooldown SET not_before=0");
  db.close();
  const before = await readFile(path);
  await expect(Session.open(dir, deps)).rejects.toThrow("rollback");
  expect(requests).toBe(1);
  expect(await readFile(path)).toEqual(before);
});

test("unknown transport is a durable stop and cannot be bypassed by reopen", async () => {
  const dir = await root(),
    time = clock();
  let requests = 0;
  const deps = {
    ...time,
    fetch: async () => {
      requests++;
      throw new TypeError("fixture network loss");
    },
  };
  const s = await Session.open(dir, deps),
    run = s.start("fixture", {});
  await expect(
    s.request(run, "a", origin + "/api/views/8c6z-qnmj.json"),
  ).rejects.toThrow();
  await s.close();
  await expect(Session.open(dir, deps)).rejects.toThrow("unknown");
  expect(requests).toBe(1);
});

test("exclusive owner, no-clobber originals and hash corruption rejection", async () => {
  const dir = await root(),
    time = clock(),
    deps = { ...time, fetch: async () => new Response("[]") };
  const s = await Session.open(dir, deps);
  await expect(Session.open(dir, deps)).rejects.toThrow();
  const run = s.start("fixture", {});
  await s.request(run, "a", origin + "/api/views/8c6z-qnmj.json");
  const observation = s.archive.store.observation(run, "a")!;
  await s.close();
  const path = join(dir, "transport", observation.path);
  await chmod(path, 0o600);
  await writeFile(path, "{}");
  await expect(Session.open(dir, deps)).rejects.toThrow("checksum");
});

test("invalid UTF-8 is rejected before semantic interpretation; retained bytes are not replacement decoded", async () => {
  const dir = await root(),
    time = clock();
  const s = await Session.open(dir, {
    ...time,
    fetch: async () =>
      new Response(new Uint8Array([0x5b, 0x22, 0xff, 0x22, 0x5d])),
  });
  const run = s.start("fixture", {});
  await expect(
    s.request(run, "invalid", origin + "/api/views/8c6z-qnmj.json"),
  ).rejects.toThrow("UTF-8");
  await s.close();
});

test("opening an archive never makes an immutable original writable again", async () => {
  const dir = await root(),
    time = clock(),
    deps = { ...time, fetch: async () => new Response("[]") };
  let s = await Session.open(dir, deps);
  const run = s.start("fixture", {});
  await s.request(run, "a", origin + "/api/views/8c6z-qnmj.json");
  const path = join(
    dir,
    "transport",
    s.archive.store.observation(run, "a")!.path,
  );
  await s.close();
  const { stat } = await import("node:fs/promises");
  expect((await stat(path)).mode & 0o222).toBe(0);
  s = await Session.open(dir, deps);
  expect((await stat(path)).mode & 0o222).toBe(0);
  await s.close();
});

test("pending original recovery uses retained checksum and no extra request", async () => {
  const dir = await root(),
    time = clock();
  let calls = 0;
  const deps = {
    ...time,
    fetch: async () => {
      calls++;
      return new Response("[]");
    },
  };
  let s = await Session.open(dir, deps),
    run = s.start("fixture", {});
  await s.request(run, "a", origin + "/api/views/8c6z-qnmj.json");
  const row = s.archive.store.observation(run, "a")!;
  await s.close();
  const { rename } = await import("node:fs/promises");
  await rename(
    join(dir, "transport", row.path),
    join(dir, "transport", row.path + ".pending"),
  );
  const db = new Database(join(dir, "transport", "state.sqlite"));
  db.exec("UPDATE observations SET status='pending'");
  db.close();
  s = await Session.open(dir, deps);
  expect(await s.request(run, "a", origin + "/api/views/8c6z-qnmj.json")).toBe(
    "[]",
  );
  await s.close();
  expect(calls).toBe(1);
});

test("failed original bytes remain private for retained diagnostic and recovery evidence", async () => {
  const dir = await root(),
    time = clock(),
    s = await Session.open(dir, {
      ...time,
      fetch: async () => new Response("{}"),
    });
  const run = s.start("fixture", {});
  await expect(
    s.request(run, "a", origin + "/api/views/8c6z-qnmj.json", () => {
      throw Error("authored decoder failure");
    }),
  ).rejects.toThrow("authored");
  const id = s.archive.store.db
    .query<{ id: string }, []>("SELECT id FROM attempts")
    .get()!.id;
  const { stat } = await import("node:fs/promises");
  expect(
    (await stat(join(dir, "transport", id + ".body.pending"))).mode & 0o077,
  ).toBe(0);
  await s.close();
});

test("late body failure after successful headers is an unknown-transfer stop on reopen", async () => {
  const dir = await root(),
    time = clock();
  let calls = 0;
  const deps = {
    ...time,
    fetch: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("["));
            c.error(Error("authored stream reset"));
          },
        }),
      );
    },
  };
  const s = await Session.open(dir, deps),
    run = s.start("fixture", {});
  await expect(
    s.request(run, "a", origin + "/api/views/8c6z-qnmj.json"),
  ).rejects.toThrow();
  await s.close();
  await expect(Session.open(dir, deps)).rejects.toThrow("unknown");
  expect(calls).toBe(1);
});
