import { test, expect } from "bun:test";
import { policyFixture } from "./support/policy-fixture";
import { join } from "node:path";
import { writeFile, readFile, readdir, lstat } from "node:fs/promises";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
async function state(root: string) {
  const out: Record<string, unknown> = {};
  for (const n of (await readdir(root)).sort()) {
    const p = join(root, n),
      s = await lstat(p);
    if (s.isFile())
      out[n] = [
        s.mode,
        createHash("sha256")
          .update(await readFile(p))
          .digest("hex"),
      ];
  }
  return out;
}
for (const extra of [
  ["--max-requests", "3"],
  ["--max-bytes", "0"],
  ["--source", "water"],
  ["--resume", "a".repeat(36)],
  ["--app-data-format", "json-or-empty-v2"],
])
  test(
    "policy invalid invocation has no writer or dispatch " + extra.join(" "),
    async () => {
      const f = await policyFixture();
      try {
        const args = await f.produce(),
          before = await state(f.root);
        const r = await f.invoke([...args, ...extra]);
        expect(r.exit).toBe(1);
        expect(f.wire.length).toBe(5);
        expect(await state(f.root)).toEqual(before);
      } finally {
        f.close();
      }
    },
    15000,
  );
test("policy cannot initialize a new archive", async () => {
  const f = await policyFixture();
  try {
    const args = await f.produce(),
      absent = join(f.base, "absent");
    args[args.indexOf("--archive") + 1] = absent;
    expect((await f.invoke(args)).exit).toBe(1);
    await expect(lstat(absent)).rejects.toThrow();
    expect(f.wire.length).toBe(5);
  } finally {
    f.close();
  }
}, 15000);
test("policy refuses locked owner before mutation", async () => {
  const f = await policyFixture();
  try {
    const args = await f.produce();
    await writeFile(join(f.root, ".civicclerk.lock"), "authored owner");
    const before = await state(f.root);
    expect((await f.invoke(args)).exit).toBe(1);
    expect(await state(f.root)).toEqual(before);
    expect(f.wire.length).toBe(5);
  } finally {
    f.close();
  }
}, 15000);
test("one-request allocation stops after redirect without next dispatch", async () => {
  const f = await policyFixture();
  try {
    const args = await f.produce();
    const r = await f.invoke([...args, "--max-requests", "1"]);
    expect(r.exit).toBe(1);
    expect(f.wire.length).toBe(6);
    const before = await state(f.root);
    expect((await f.invoke(["verify", "--archive", f.root], true)).exit).toBe(
      1,
    );
    expect(await state(f.root)).toEqual(before);
  } finally {
    f.close();
  }
}, 15000);
test("binary invalid UTF8 body remains byte-exact and never policy", async () => {
  const f = await policyFixture();
  try {
    const args = await f.produce();
    f.mode.status = 200;
    f.mode.body = Buffer.from([255, 254, 0]);
    f.mode.mime = "application/octet-stream";
    const r = await f.invoke(args);
    expect(r.exit).toBe(0);
    const s = JSON.parse(r.out).summary;
    expect(s.outcome).toBe("binary-not-policy");
    expect(s.permission).toBe(false);
    expect(await readFile(join(f.root, s.chain[0].attempt + ".body"))).toEqual(
      Buffer.from([255, 254, 0]),
    );
  } finally {
    f.close();
  }
}, 15000);
test("parseable robots text remains inspection-only", async () => {
  const f = await policyFixture();
  try {
    const args = await f.produce();
    f.mode.status = 200;
    f.mode.body = Buffer.from("User-agent: *\nDisallow: /FloodPro/\n");
    f.mode.mime = "text/plain";
    const r = await f.invoke(args);
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.out).summary).toMatchObject({
      outcome: "robots-text-inspected",
      permission: false,
      navigation: false,
    });
    expect(f.wire.length).toBe(6);
  } finally {
    f.close();
  }
}, 15000);
test("simulated crash between ready capture and final summary cannot be reused", async () => {
  const f = await policyFixture();
  try {
    const args = await f.produce();
    expect((await f.invoke(args)).exit).toBe(0);
    const db = new Database(join(f.root, "state.sqlite"));
    db.query(
      "UPDATE runs SET status='running',summary=NULL,finished=NULL WHERE command='inspect-policy'",
    ).run();
    db.close();
    const before = await state(f.root);
    expect((await f.invoke(args, true)).exit).toBe(1);
    expect(await state(f.root)).toEqual(before);
    expect(f.wire.length).toBe(7);
  } finally {
    f.close();
  }
}, 15000);
