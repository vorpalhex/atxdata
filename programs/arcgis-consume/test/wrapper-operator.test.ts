import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { policyFixture } from "./support/policy-fixture";
const acknowledgement = "--acknowledge-maps-robots-omission";
test("native wrapper vertical: scoped waiver, literal HTML, offline verify and exact reuse", async () => {
  const f = await policyFixture();
  try {
    const policy = await f.produce();
    const old = await f.invoke(policy);
    expect(old.exit).toBe(0);
    const before = f.wire.length;
    f.mode.status = 200;
    f.mode.body = Buffer.from(
      '<!doctype html><html><script src="./bootstrap.js"></script><link href="./style.css" rel="stylesheet"></html>',
    );
    const args = ["inspect-wrapper", ...policy.slice(1), acknowledgement];
    const live = await f.invoke(args);
    expect(live.err).toBe("");
    expect(live.exit).toBe(0);
    const result = JSON.parse(live.out);
    expect(f.wire.slice(before).map((x) => x.url)).toEqual([
      "https://maps.austintexas.gov/FloodPro/",
    ]);
    expect(result.summary).toMatchObject({
      wrapperReceiptVersion: 1,
      wrapperHtmlCaptured: true,
      wrapperResolved: false,
      acquiredFeatures: false,
      acquiredFiles: false,
      bootstrapAcquired: false,
      semanticServiceEquivalence: false,
      waiver: {
        acknowledged: true,
        resource: "https://maps.austintexas.gov/robots.txt",
        operation: "app-wrapper-v1",
      },
    });
    expect(result.summary.references[0]).toMatchObject({
      literal: "./bootstrap.js",
      acquired: false,
    });
    const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
    const obs = db
      .query<{ path: string; kind: string }, [string]>(
        "SELECT path,kind FROM observations WHERE run=?",
      )
      .get(result.run)!;
    expect(obs.kind).toBe("wrapper-raw-v1");
    expect(await readFile(join(f.root, obs.path))).toEqual(f.mode.body);
    const saved = db
      .query("SELECT * FROM runs WHERE id=?")
      .get(JSON.parse(old.out).run);
    db.close();
    expect((await f.invoke(["verify", "--archive", f.root], true)).exit).toBe(
      0,
    );
    const reuse = await f.invoke(args, true);
    expect(reuse.err).toBe("");
    expect(reuse.exit).toBe(0);
    expect(JSON.parse(reuse.out)).toEqual({ ...result, reused: true });
    expect(f.wire.length).toBe(before + 1);
    const after = new Database(join(f.root, "state.sqlite"), {
      readonly: true,
    });
    expect(
      after.query("SELECT * FROM runs WHERE id=?").get(JSON.parse(old.out).run),
    ).toEqual(saved);
    after.close();
  } finally {
    f.close();
  }
}, 20000);
