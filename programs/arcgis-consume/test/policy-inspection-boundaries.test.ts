import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { policyFixture } from "./support/policy-fixture";
async function physical(root: string) {
  const result: Record<string, unknown> = {};
  for (const name of (await readdir(root)).sort()) {
    const p = join(root, name),
      s = await lstat(p);
    if (s.isFile())
      result[name] = [
        s.mode,
        createHash("sha256")
          .update(await readFile(p))
          .digest("hex"),
      ];
  }
  return result;
}
async function logical(root: string) {
  const db = new Database(join(root, "state.sqlite"), { readonly: true });
  const names = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all();
  const tables = names.map(({ name }) => [
    name,
    db.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
  ]);
  db.close();
  return tables;
}
for (const [status, outcome] of [
  [200, "html-not-policy"],
  [302, "html-not-policy"],
  [403, "access-denied"],
  [500, "http-error"],
  [503, "http-error"],
] as const)
  test(
    "native raw inspection terminal has no permission " + status,
    async () => {
      const f = await policyFixture();
      try {
        const args = await f.produce();
        f.mode.status = status;
        const before = await logical(f.root);
        const r = await f.invoke(args);
        expect(r.err).toBe("");
        expect(r.exit).toBe(0);
        const s = JSON.parse(r.out).summary;
        expect(s.permission).toBe(false);
        expect(s.navigation).toBe(false);
        expect(s.outcome).toBe(outcome);
        expect(s.chain[0].status).toBe(status);
        expect(f.wire.length).toBe(status === 302 ? 8 : 7);
        const stable = await logical(f.root);
        expect(
          (await f.invoke(["verify", "--archive", f.root], true)).exit,
        ).toBe(0);
        expect((await f.invoke(args, true)).exit).toBe(0);
        expect(await logical(f.root)).toEqual(stable);
        const old = (
          before.find((row) => row[0] === "observations") as [string, unknown[]]
        )[1];
        const after = (
          stable.find((row) => row[0] === "observations") as [string, unknown[]]
        )[1];
        expect(after.slice(0, old.length)).toEqual(old);
      } finally {
        f.close();
      }
    },
    15000,
  );
for (const location of [
  "https://other.invalid/",
  "http://geohub.austintexas.gov/",
  "/",
  "https://maps.austintexas.gov/robots.txt",
  "https://geohub.austintexas.gov/?token=fixture",
])
  test(
    "native unexpected redirect never repaired or followed " + location,
    async () => {
      const f = await policyFixture();
      try {
        const args = await f.produce();
        f.mode.location = location;
        const r = await f.invoke(args);
        expect(r.exit).toBe(0);
        expect(JSON.parse(r.out).summary.outcome).toBe("redirect-unapproved");
        expect(f.wire.length).toBe(7);
        expect(r.out).not.toContain("token=fixture");
      } finally {
        f.close();
      }
    },
    15000,
  );
const headerCases: Record<string, string>[] = [
  { "www-authenticate": "Basic" },
  { "cf-mitigated": "challenge" },
  { "retry-after": "9" },
];
for (const headers of headerCases)
  test(
    "native redirect auth/challenge/hold prevents edge " +
      Object.keys(headers)[0],
    async () => {
      const f = await policyFixture();
      try {
        const args = await f.produce();
        f.mode.headers = headers;
        const r = await f.invoke(args);
        expect(r.exit).toBe(0);
        expect(JSON.parse(r.out).summary.chain.length).toBe(1);
        expect(f.wire.length).toBe(7);
      } finally {
        f.close();
      }
    },
    15000,
  );
test("native bad source SHA refuses before writer and HTTP", async () => {
  const f = await policyFixture();
  try {
    const args = await f.produce();
    args[args.indexOf("--app-item-sha256") + 1] = "0".repeat(64);
    const before = await physical(f.root);
    const r = await f.invoke(args);
    expect(r.exit).toBe(1);
    expect(f.wire.length).toBe(6);
    expect(await physical(f.root)).toEqual(before);
  } finally {
    f.close();
  }
}, 15000);
for (const fault of [
  "summary",
  "joint",
  "location",
  "status",
  "body",
  "source",
])
  test(
    "native readonly replay rejects corrupted " + fault,
    async () => {
      const f = await policyFixture();
      try {
        const args = await f.produce();
        expect((await f.invoke(args)).exit).toBe(0);
        const db = new Database(join(f.root, "state.sqlite"));
        const row = db
          .query<{ id: string; summary: string; options: string }, []>(
            "SELECT r.id,r.summary,o.options FROM runs r JOIN acquisition_options o ON o.run=r.id WHERE r.command='inspect-policy'",
          )
          .get()!;
        if (fault === "summary" || fault === "joint") {
          const summary = JSON.parse(row.summary);
          summary.policyReceiptVersion = 0;
          db.query("UPDATE runs SET summary=? WHERE id=?").run(
            JSON.stringify(summary),
            row.id,
          );
          if (fault === "joint") {
            const s = JSON.parse(row.options);
            delete s.policyReceiptVersion;
            delete s.mode;
            db.query(
              "UPDATE acquisition_options SET options=? WHERE run=?",
            ).run(JSON.stringify(s), row.id);
          }
        }
        if (fault === "location") {
          const a = db
            .query<{ id: string; headers: string }, [string]>(
              "SELECT id,headers FROM attempts WHERE run=? AND label='policy-hop-0'",
            )
            .get(row.id)!;
          const h = JSON.parse(a.headers);
          h.location = "https://other.invalid/";
          db.query("UPDATE attempts SET headers=? WHERE id=?").run(
            JSON.stringify(h),
            a.id,
          );
        }
        if (fault === "status")
          db.query(
            "UPDATE attempts SET status=200 WHERE run=? AND label='policy-hop-0'",
          ).run(row.id);
        if (fault === "source") {
          const s = JSON.parse(row.options);
          s.binding.publishedURL =
            "https://maps.austintexas.gov/PropertyProfile/";
          db.query("UPDATE acquisition_options SET options=? WHERE run=?").run(
            JSON.stringify(s),
            row.id,
          );
        }
        if (fault === "body") {
          const o = db
            .query<{ path: string }, [string]>(
              "SELECT path FROM observations WHERE run=? AND label='policy-hop-0'",
            )
            .get(row.id)!;
          await writeFile(join(f.root, o.path), "changed");
        }
        db.close();
        const before = await physical(f.root);
        const r = await f.invoke(["verify", "--archive", f.root], true);
        expect(r.exit).toBe(1);
        expect(await physical(f.root)).toEqual(before);
        expect(f.wire.length).toBe(8);
      } finally {
        f.close();
      }
    },
    15000,
  );
