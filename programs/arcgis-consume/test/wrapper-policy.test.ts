import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { policyFixture } from "./support/policy-fixture";
test("native source-linked policy301 to HTML records raw chain without permission", async () => {
  const f = await policyFixture();
  try {
    const args = await f.produce();
    const r = await f.invoke(args);
    expect(r.err).toBe("");
    expect(r.exit).toBe(0);
    const s = JSON.parse(r.out).summary;
    expect(s).toMatchObject({
      policyReceiptVersion: 1,
      permission: false,
      navigation: false,
      outcome: "html-not-policy",
    });
    expect(s.chain.length).toBe(2);
    expect(s.chain[0].status).toBe(301);
    expect(s.chain[0].location).toBe("https://geohub.austintexas.gov/");
    expect(s.chain[1].url).toBe("https://geohub.austintexas.gov/");
    expect(f.wire.length).toBe(7);
    expect(f.wire.every((w) => w.ua)).toBe(true);
    const verify = await f.invoke(["verify", "--archive", f.root], true);
    expect(verify.err).toBe("");
    expect(verify.exit).toBe(0);
    const reuse = await f.invoke(args, true);
    expect(reuse.err).toBe("");
    expect(reuse.exit).toBe(0);
    expect(JSON.parse(reuse.out).reused).toBe(true);
    expect(f.wire.length).toBe(7);
  } finally {
    f.close();
  }
}, 15000);
