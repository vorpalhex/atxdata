import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { policyFixture } from "./support/policy-fixture";
import { parseArgs } from "../src/cli";
import { Archive } from "../src/archive";
import { inspectWrapper } from "../src/wrapper";
import { validateWrapperOptions, waiver } from "../src/wrapper-contract";
const ack = "--acknowledge-maps-robots-omission";
const args = (p: string[]) => ["inspect-wrapper", ...p.slice(1), ack];
async function files(root: string) {
  const out: Record<string, Buffer> = {};
  for (const n of (await readdir(root)).sort())
    out[n] = await readFile(join(root, n));
  return out;
}
const base = {
  item: "d".repeat(32),
  appRun: "a".repeat(36),
  appItemSha256: "b".repeat(64),
  budget: {
    requests: 1,
    totalBytes: 1000000,
    responseBytes: 1000000,
    zipBytes: 1000000,
    retries: 0,
  },
};
for (const value of [undefined, false, "true", "yes", 1])
  test(`strict API acknowledgement ${String(value)}`, () => {
    expect(() =>
      validateWrapperOptions({ ...base, acknowledgeMapsRobotsOmission: value }),
    ).toThrow(/boolean/);
  });
test("native bare flag only, command scope and finite ceilings", async () => {
  const f = await policyFixture();
  try {
    const p = await f.produce();
    const before = await files(f.root);
    for (const suffix of [
      [],
      [ack + "=true"],
      [ack + "=false"],
      [ack, "false"],
      [ack, ack],
      [ack, "--max-requests", "2"],
      [ack, "--response-bytes", "1000001"],
      [ack, "--max-bytes", "0"],
    ]) {
      const r = await f.invoke(
        ["inspect-wrapper", ...p.slice(1), ...suffix],
        true,
      );
      expect(r.exit).toBe(1);
    }
    expect((await f.invoke([...p, ack], true)).exit).toBe(1);
    expect(f.wire.length).toBe(6);
    expect(await files(f.root)).toEqual(before);
  } finally {
    f.close();
  }
});
for (const v1 of [false, true])
  test(`generic catalog item and published path, v1=${v1}`, async () => {
    const f = await policyFixture({
      id: "e".repeat(32),
      publishedURL: "https://maps.austintexas.gov/AnotherApp/",
      v1,
    });
    try {
      const p = await f.produce();
      f.mode.status = 200;
      const r = await f.invoke(args(p));
      expect(r.err).toBe("");
      expect(r.exit).toBe(0);
      expect(f.wire.slice(6).map((x) => x.url)).toEqual([
        "https://maps.austintexas.gov/AnotherApp/",
      ]);
      expect(JSON.parse(r.out).summary.waiver.appReceiptVersion).toBe(
        v1 ? 1 : 2,
      );
    } finally {
      f.close();
    }
  });
for (const publishedURL of [
  "https://geohub.austintexas.gov/",
  "http://maps.austintexas.gov/App/",
  "https://maps.austintexas.gov/robots.txt",
  "https://maps.austintexas.gov/App/?token=private",
])
  test(`no wrapper waiver outside literal scope ${publishedURL}`, async () => {
    const f = await policyFixture({ publishedURL });
    try {
      const p = await f.produce();
      const before = await files(f.root);
      const r = await f.invoke(args(p), true);
      expect(r.exit).toBe(1);
      expect(f.wire.length).toBe(6);
      expect(await files(f.root)).toEqual(before);
    } finally {
      f.close();
    }
  });
for (const label of [
  "unchanged",
  "catalog",
  "site-data",
  "robots-www.arcgis.com",
])
  test(`complete source prewriter fence ${label}`, async () => {
    const f = await policyFixture();
    try {
      const p = await f.produce();
      if (label !== "unchanged") {
        const db = new Database(join(f.root, "state.sqlite"));
        const o = db
          .query<{ path: string }, [string]>(
            "SELECT path FROM observations WHERE label=?",
          )
          .get(label)!;
        db.close();
        await writeFile(join(f.root, o.path), "corrupt");
      }
      const fence = join(f.base, "fence.ts");
      await writeFile(
        fence,
        `import {Archive} from ${JSON.stringify(join(import.meta.dir, "../src/archive.ts"))};Archive.open=async()=>{throw Error("WRITER_FENCE")};globalThis.fetch=()=>{throw Error("FETCH_FENCE")};`,
      );
      const before = await files(f.root);
      const c = Bun.spawn(
        [
          process.execPath,
          "--preload",
          fence,
          join(import.meta.dir, "../src/cli.ts"),
          ...args(p),
        ],
        { env: process.env, stdout: "pipe", stderr: "pipe" },
      );
      const [err, exit] = await Promise.all([
        new Response(c.stderr).text(),
        c.exited,
      ]);
      expect(exit).toBe(1);
      if (label === "unchanged") expect(err).toContain("WRITER_FENCE");
      else expect(err).not.toContain("WRITER_FENCE");
      expect(err).not.toContain("FETCH_FENCE");
      expect(await files(f.root)).toEqual(before);
      expect(f.wire.length).toBe(6);
    } finally {
      f.close();
    }
  });
test("direct API rejects corrupt catalog without further ledger mutation or HTTP", async () => {
  const f = await policyFixture();
  let a: Archive | undefined;
  try {
    const p = await f.produce();
    let calls = 0;
    a = await Archive.open(f.root, {
      fetch: async () => {
        calls++;
        throw Error("FETCH_FENCE");
      },
    });
    const o = a.store.db
      .query<{ path: string }, []>(
        "SELECT path FROM observations WHERE label='catalog'",
      )
      .get()!;
    await writeFile(join(f.root, o.path), "corrupt");
    const before = a.store.db.serialize();
    await expect(
      inspectWrapper(a, parseArgs(args(p)).wrapper!),
    ).rejects.toThrow(/checksum|size/);
    expect(calls).toBe(0);
    expect(a.store.db.serialize()).toEqual(before);
  } finally {
    await a?.close();
    f.close();
  }
});
for (const fault of ["waiver", "string-ack", "body", "hold", "limits"])
  test(`offline refusal ${fault}`, async () => {
    const f = await policyFixture();
    try {
      const p = await f.produce();
      f.mode.status = 200;
      const r = await f.invoke(args(p));
      expect(r.exit).toBe(0);
      const id = JSON.parse(r.out).run;
      const db = new Database(join(f.root, "state.sqlite"));
      if (fault === "waiver" || fault === "string-ack") {
        const row = db
          .query<{ options: string }, [string]>(
            "SELECT options FROM acquisition_options WHERE run=?",
          )
          .get(id)!;
        const s = JSON.parse(row.options);
        if (fault === "waiver")
          s.waiver.resource = "https://geohub.austintexas.gov/robots.txt";
        else s.selection.acknowledgeMapsRobotsOmission = "true";
        db.query("UPDATE acquisition_options SET options=? WHERE run=?").run(
          JSON.stringify(s),
          id,
        );
      }
      if (fault === "hold")
        db.query("UPDATE cooldown SET not_before=?").run(
          Number.MAX_SAFE_INTEGER,
        );
      if (fault === "body") {
        const row = db
          .query<{ path: string }, [string]>(
            "SELECT path FROM observations WHERE run=?",
          )
          .get(id)!;
        await writeFile(join(f.root, row.path), "corrupt");
      }
      db.close();
      const before = await files(f.root);
      const r2 = await f.invoke(
        fault === "limits" ? [...args(p), "--max-bytes", "16"] : args(p),
        true,
      );
      expect(r2.exit).toBe(1);
      expect(f.wire.length).toBe(7);
      expect(await files(f.root)).toEqual(before);
      if (fault !== "limits")
        expect(
          (await f.invoke(["verify", "--archive", f.root], true)).exit,
        ).toBe(1);
    } finally {
      f.close();
    }
  });
for (const status of [302, 403, 429, 503])
  test(`original status retained without follow or HTML acceptance ${status}`, async () => {
    const f = await policyFixture();
    try {
      const p = await f.produce();
      f.mode.status = status;
      if (status === 429) f.mode.headers["retry-after"] = "7";
      const r = await f.invoke(args(p));
      expect(r.exit).toBe(1);
      expect(f.wire.length).toBe(7);
      const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
      const row = db
        .query<{ status: number; bytes: number }, []>(
          "SELECT status,bytes FROM attempts ORDER BY rowid DESC LIMIT 1",
        )
        .get()!;
      expect(row.status).toBe(status);
      expect(row.bytes).toBe(f.mode.body.length);
      db.close();
    } finally {
      f.close();
    }
  });
test("response cap preserves failed intent and raw decoded byte accounting", async () => {
  const f = await policyFixture();
  try {
    const p = await f.produce();
    f.mode.status = 200;
    const r = await f.invoke([...args(p), "--response-bytes", "4"]);
    expect(r.exit).toBe(1);
    expect(f.wire.length).toBe(7);
    const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
    expect(
      db
        .query<{ not_before: number }, []>("SELECT not_before FROM cooldown")
        .get()!.not_before,
    ).toBe(Number.MAX_SAFE_INTEGER);
    db.close();
  } finally {
    f.close();
  }
});
test("HTML reference collection never executes or follows private/third-party URLs", async () => {
  const f = await policyFixture();
  try {
    const p = await f.produce();
    f.mode.status = 200;
    f.mode.body = Buffer.from(
      '<html><base href="https://outside.invalid/"><script src="./ok.js"></script><script src="./x.js?token=PRIVATE"></script><script src="https://outside.invalid/PRIVATE"></script><script>fetch("https://outside.invalid/")</script></html>',
    );
    const r = await f.invoke(args(p));
    expect(r.exit).toBe(0);
    expect(r.out).not.toContain("PRIVATE");
    expect(f.wire.length).toBe(7);
    expect(
      JSON.parse(r.out).summary.references.every(
        (x: { acquired: boolean }) => x.acquired === false,
      ),
    ).toBe(true);
  } finally {
    f.close();
  }
});
test("waiver decision invariants cannot be overwritten by binding fields", () => {
  const result = waiver(
    {
      acknowledged: false,
      resource: "https://outside.invalid/robots.txt",
      operation: "other",
      run: "other",
    },
    "actual-run",
  );
  expect(result.acknowledged).toBe(true);
  expect(result.resource).toBe("https://maps.austintexas.gov/robots.txt");
  expect(result.operation).toBe("app-wrapper-v1");
  expect(result.run).toBe("actual-run");
});
test("raw wrapper bridge itself refuses missing waiver before transport", async () => {
  const f = await policyFixture();
  let a: Archive | undefined;
  try {
    await f.produce();
    let calls = 0;
    a = await Archive.open(f.root, {
      fetch: async () => {
        calls++;
        return new Response("<html></html>", {
          headers: { "content-length": "13", "content-type": "text/html" },
        });
      },
    });
    const key = "fixture-raw";
    a.store.source(key, "test", "https://maps.austintexas.gov/FloodPro/");
    const run = a.store.start(key, "inspect-wrapper");
    a.store.saveOptions(run, {
      mode: "app-wrapper-v1",
      wrapperReceiptVersion: 1,
      wireKind: "wrapper-raw-v1",
      budget: base.budget,
    });
    await expect(
      a.request(
        run,
        "wrapper-html",
        "https://maps.austintexas.gov/FloodPro/",
        "wrapper-raw-v1",
      ),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  } finally {
    await a?.close();
    f.close();
  }
});
