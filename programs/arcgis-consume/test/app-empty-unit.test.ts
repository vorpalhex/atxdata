import { rename } from "node:fs/promises";
import { verifyAppRuns } from "../src/app-metadata";
import { v2Receipt } from "../src/app-data";
import { itemUrl } from "../src/sources";
import { readFile, readdir } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { readonlySQLiteImage } from "../src/app-wal";
import { createHash } from "node:crypto";
import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { Archive } from "../src/archive";
import { inspectApp } from "../src/app-metadata";
import { selectionOptions } from "../src/selection";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
const id = "8".repeat(32),
  item = {
    id,
    title: "Synthetic v2",
    type: "Web Mapping Application",
    access: "public",
    url: "http://example.invalid/metadata-only",
    licenseInfo: "Fixture terms",
  };
function deps(body: () => Response, currentItem: unknown = item) {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    fetch: async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/robots.txt")
        return new Response("User-agent: *\nAllow: /\n");
      if (u.pathname.endsWith("/search"))
        return Response.json({ total: 1, nextStart: -1, results: [item] });
      if (u.pathname.endsWith(configs.austin.site + "/data"))
        return Response.json({
          catalogV2: {
            scopes: {
              item: {
                filters: [{ predicates: [{ group: ["a".repeat(32)] }] }],
              },
            },
          },
        });
      if (u.pathname.endsWith(configs.austin.site))
        return Response.json({ ...item, id: configs.austin.site });
      if (u.pathname.endsWith(id + "/data")) return body();
      if (u.pathname.endsWith(id)) return Response.json(currentItem);
      throw Error("unexpected fixture route");
    },
  };
}
function args(root: string) {
  return [
    "inspect-app",
    "--source",
    "austin",
    "--item",
    id,
    "--archive",
    root,
    "--terms-sha256",
    terms(item).sha256,
    "--catalog-terms-sha256",
    terms(item).sha256,
    "--app-data-format",
    "json-or-empty-v2",
  ];
}
test("synthetic normally closed zero with positive declared length cannot certify framing", async () => {
  const root = await mkdtemp(
    join(process.env.TMPDIR!, "v2-synthetic-framing-"),
  );
  const d = deps(
    () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        {
          headers: {
            "content-type": "text/plain;charset=utf-8",
            "content-length": "10",
          },
        },
      ),
  );
  await expect(main(args(root), d)).rejects.toThrow("manual review");
});
for (const body of [
  "",
  "{}",
  "null",
  JSON.stringify(""),
  "[]",
  JSON.stringify({ error: { code: 400 } }),
])
  test(
    "in-process v2 capture/replay coverage for " + JSON.stringify(body),
    async () => {
      const root = await mkdtemp(join(process.env.TMPDIR!, "v2-direct-"));
      const d = deps(
        () =>
          new Response(
            new ReadableStream({
              start(c) {
                if (body) c.enqueue(new TextEncoder().encode(body));
                c.close();
              },
            }),
            {
              headers: {
                "content-type": "text/plain;charset=utf-8",
                "content-length": String(Buffer.byteLength(body)),
              },
            },
          ),
      );
      const result = (await main(args(root), d)) as {
        summary: { representation: string };
      };
      expect(result.summary.representation).toBe(body ? "json" : "empty-body");
      expect(
        (
          (await main(["verify", "--archive", root], d)) as {
            appMetadata: number;
          }
        ).appMetadata,
      ).toBe(1);
      expect(((await main(args(root), d)) as { reused: boolean }).reused).toBe(
        true,
      );
    },
  );
test("already-open public library holds allow no further mutation", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "v2-library-hold-"));
  const a = await Archive.open(root);
  try {
    a.store.defer(Number.MAX_SAFE_INTEGER);
    const before = a.store.db.query("SELECT * FROM runs").all();
    await expect(
      inspectApp(a, "austin", {
        ...selectionOptions({ "--item": id })!,
        termsSha256: "a".repeat(64),
        catalogTermsSha256: "b".repeat(64),
        appDataFormat: "json-or-empty-v2",
      }),
    ).rejects.toThrow("manual review");
    expect(a.store.db.query("SELECT * FROM runs").all()).toEqual(before);
  } finally {
    await a.close();
  }
});

test("invalid public-library v2 format is rejected before any further mutation", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "v2-library-format-"));
  const a = await Archive.open(root);
  try {
    const before = {
      runs: a.store.db.query("SELECT * FROM runs").all(),
      sources: a.store.db.query("SELECT * FROM sources").all(),
    };
    await expect(
      inspectApp(a, "austin", {
        ...selectionOptions({ "--item": id })!,
        termsSha256: "a".repeat(64),
        catalogTermsSha256: "b".repeat(64),
        appDataFormat: "json-or-empty-v3",
      }),
    ).rejects.toThrow("unsupported app-data format");
    expect({
      runs: a.store.db.query("SELECT * FROM runs").all(),
      sources: a.store.db.query("SELECT * FROM sources").all(),
    }).toEqual(before);
  } finally {
    await a.close();
  }
});

test("memory-only WAL snapshot equals native committed view and rejects corrupted framing", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "wal-oracle-")),
    path = join(root, "state.sqlite");
  const writer = new Database(path);
  writer.exec(
    "PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;CREATE TABLE oracle(value TEXT);INSERT INTO oracle VALUES(char(65));",
  );
  try {
    const main = await readFile(path),
      wal = await readFile(path + "-wal");
    const oracle = new Database(path, { readonly: true });
    const expected = oracle.query("SELECT * FROM oracle").all();
    oracle.close();
    Bun.gc(true);
    const names = (await readdir(root)).sort();
    const before = await Promise.all(
      names.map(async (n) => [
        n,
        createHash("sha256")
          .update(await readFile(join(root, n)))
          .digest("hex"),
      ]),
    );
    const view = Database.deserialize(readonlySQLiteImage(main, wal), {
      readonly: true,
    });
    expect(view.query("SELECT * FROM oracle").all()).toEqual(expected);
    view.close();
    expect(
      await Promise.all(
        names.map(async (n) => [
          n,
          createHash("sha256")
            .update(await readFile(join(root, n)))
            .digest("hex"),
        ]),
      ),
    ).toEqual(before);
    for (const offset of [0, 24, 32 + 8, 32 + 16, 32 + 24]) {
      const bad = Buffer.from(wal);
      bad[offset] = bad[offset]! ^ 1;
      expect(() => readonlySQLiteImage(main, bad)).toThrow();
    }
    expect(() =>
      readonlySQLiteImage(main, wal.subarray(0, wal.length - 1)),
    ).toThrow("incomplete WAL");
  } finally {
    writer.close();
  }
});

for (const value of [null, [], { error: { code: 400 } }])
  test(
    "in-process v2 not-requested receipt absence is coherent " +
      JSON.stringify(value),
    async () => {
      const root = await mkdtemp(
        join(process.env.TMPDIR!, "v2-item-negative-"),
      );
      let data = 0;
      const d = deps(() => {
        data++;
        throw Error("app-data must not be requested");
      }, value);
      const result = (await main(args(root), d)) as {
        summary: { representation: string };
      };
      expect(result.summary.representation).toBe("not-requested");
      expect(data).toBe(0);
      expect(
        (
          (await main(["verify", "--archive", root], d)) as {
            appMetadata: number;
          }
        ).appMetadata,
      ).toBe(1);
      expect(data).toBe(0);
    },
  );

test("already-open v2 pending replay refuses before recovery or any further mutation", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "v2-library-pending-"));
  const d = deps(
    () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        {
          headers: {
            "content-type": "text/plain;charset=utf-8",
            "content-length": "0",
          },
        },
      ),
  );
  const result = (await main(args(root), d)) as { run: string };
  const a = await Archive.open(root, d);
  try {
    const row = a.store.observation(result.run, "app-data")!;
    await rename(join(root, row.path), join(root, row.path + ".pending"));
    a.store.db
      .query("UPDATE observations SET status=? WHERE run=? AND label=?")
      .run("pending", result.run, "app-data");
    const before = (await readdir(root)).sort();
    await expect(verifyAppRuns(a)).rejects.toThrow("pending");
    expect(a.store.observation(result.run, "app-data")?.status).toBe("pending");
    expect((await readdir(root)).sort()).toEqual(before);
    await expect(
      inspectApp(a, "austin", {
        ...selectionOptions({ "--item": id })!,
        termsSha256: terms(item).sha256,
        catalogTermsSha256: terms(item).sha256,
        appDataFormat: "json-or-empty-v2",
      }),
    ).rejects.toThrow("pending");
    expect(a.store.observation(result.run, "app-data")?.status).toBe("pending");
    expect((await readdir(root)).sort()).toEqual(before);
  } finally {
    await a.close();
  }
});
test("v2 producer identifier cannot become a traversal body path", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "v2-id-path-"));
  const d = deps(
    () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        {
          headers: {
            "content-type": "text/plain;charset=utf-8",
            "content-length": "0",
          },
        },
      ),
  );
  const result = (await main(args(root), d)) as { run: string };
  const a = await Archive.open(root, d);
  try {
    a.store.db
      .query("UPDATE attempts SET id=? WHERE run=? AND label=?")
      .run("../../outside", result.run, "app-data");
    a.store.db
      .query("UPDATE observations SET path=? WHERE run=? AND label=?")
      .run("../../outside.body", result.run, "app-data");
    expect(() =>
      v2Receipt(a.store.db, result.run, itemUrl(id, true), "empty-body"),
    ).toThrow("producer identifier");
  } finally {
    await a.close();
  }
});
