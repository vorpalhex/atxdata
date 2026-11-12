import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { main } from "../src/cli";
import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { terms } from "../src/rules";
import { configs } from "../src/sources";
const id = "b".repeat(32);
const item = {
  id,
  access: "public",
  type: "Web Mapping Application",
  title: "Synthetic app",
  url: "https://maps.austintexas.gov/Synthetic/",
  licenseInfo: "Synthetic metadata only",
};
for (const [name, body, outcome] of [
  ["malformed", "{", "unknown"],
  ["empty", "{}", "empty"],
  ["error", '{"error":{"code":400}}', "error"],
  ["array", "[]", "empty"],
  ["scalar", "42", "unsupported"],
  ["null", "null", "empty"],
  [
    "unknown-shape",
    '{"webmap":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    "unsupported",
  ],
])
  test(
    "native inspect-app retains " +
      name +
      " metadata and verifies/reuses without HTTP",
    async () => {
      const root = await mkdtemp(join(process.env.TMPDIR!, "app-native-"));
      const archive = join(root, "archive"),
        preload = join(root, "fixture.ts");
      await writeFile(
        preload,
        `import {existsSync,readFileSync,writeFileSync} from "node:fs";const clock=${JSON.stringify(join(root, "clock"))};const item=${JSON.stringify(item)}; let now=existsSync(clock)?Number(readFileSync(clock,"utf8")):0; Date.now=()=>now; Bun.sleep=async(ms)=>{now+=ms;writeFileSync(clock,String(now))}; globalThis.fetch=async(url)=>{ const u=new URL(url); if(u.origin!=="https://www.arcgis.com") throw Error("unexpected origin"); if(u.pathname==="/robots.txt") return new Response("User-agent: *"+String.fromCharCode(10)); if(u.pathname.endsWith("/search")) return Response.json({total:1,nextStart:-1,results:[item]}); if(u.pathname.endsWith("${configs.austin.site}/data")) return Response.json({catalogV2:{scopes:{item:{filters:[{predicates:[{group:["${"e".repeat(32)}"]}]}]}}}}); if(u.pathname.endsWith("${configs.austin.site}")) return Response.json({...item,licenseInfo:"Synthetic catalog terms",id:"${configs.austin.site}"}); if(u.pathname.endsWith(item.id+"/data")) return new Response(${JSON.stringify(body)},{headers:{"content-type":"application/json"}}); if(u.pathname.endsWith(item.id)) return Response.json(item); throw Error("unexpected fixture route"); };`,
      );
      const cli = resolve(import.meta.dir, "../src/cli.ts");
      const invoke = async (args: string[], online = false) => {
        const p = Bun.spawn(
          [
            process.execPath,
            ...(online ? ["--preload", preload] : []),
            cli,
            ...args,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        return {
          out: await new Response(p.stdout).text(),
          err: await new Response(p.stderr).text(),
          exit: await p.exited,
        };
      };
      const common = ["--source", "austin", "--archive", archive];
      const rules = await invoke(["rules", ...common], true);
      expect(rules.exit).toBe(0);
      const catalogHash = JSON.parse(rules.out).summary.catalogTerms.sha256;
      const discover = await invoke(
        ["discover", ...common, "--terms-sha256", catalogHash],
        true,
      );
      expect(discover.exit).toBe(0);
      const itemRules = await invoke(["rules", ...common, "--item", id], true);
      expect(itemRules.exit).toBe(0);
      const itemHash = JSON.parse(itemRules.out).summary.terms.sha256;
      const args = [
        "inspect-app",
        "--source",
        "austin",
        "--item",
        id,
        "--archive",
        archive,
        "--terms-sha256",
        itemHash,
        "--catalog-terms-sha256",
        catalogHash,
        "--max-requests",
        "6",
        "--max-pages",
        "2",
      ];
      const positive = await invoke(args, true);
      if (outcome === "unknown") {
        expect(positive.exit).toBe(1);
        const db = new Database(join(archive, "state.sqlite"), {
          readonly: true,
        });
        try {
          expect(
            db
              .query("SELECT 1 FROM observations WHERE label=?")
              .get("app-data"),
          ).toBeNull();
          expect(
            Number(
              (
                db.query("SELECT not_before FROM cooldown").get() as {
                  not_before: number;
                }
              ).not_before,
            ),
          ).toBeGreaterThan(0);
        } finally {
          db.close();
        }
        const held = await invoke(args, true);
        expect(held.exit).toBe(1);
        expect(held.err).toMatch(/unknown|manual review/);
        return;
      }
      expect(positive.err).toBe("");
      expect(positive.exit).toBe(0);
      const result = JSON.parse(positive.out);
      expect(result.summary).toMatchObject({
        metadataOnly: true,
        wrapperResolved: false,
        outcome,
        receiptVersion: 1,
      });
      expect(result.summary.records).toBeUndefined();
      const receipt = result.summary.receipts.find(
        (r: { label: string }) => r.label === "app-data",
      );
      const raw = readFileSync(join(archive, receipt.attempt + ".body"));
      expect(raw.toString()).toBe(body!);
      expect(createHash("sha256").update(raw).digest("hex")).toBe(
        receipt.sha256,
      );
      const db = new Database(join(archive, "state.sqlite"));
      const before = db.query("SELECT COUNT(*) AS n FROM attempts").get();
      db.close();
      const check = await invoke(["verify", "--archive", archive]);
      expect(check.err).toBe("");
      expect(check.exit).toBe(0);
      expect(JSON.parse(check.out).appMetadata).toBe(1);
      const reused = await invoke(args);
      expect(reused.err).toBe("");
      expect(reused.exit).toBe(0);
      expect(JSON.parse(reused.out).reused).toBe(true);
      const corrupt = new Database(join(archive, "state.sqlite"));
      corrupt.query("UPDATE runs SET summary=NULL WHERE id=?").run(result.run);
      corrupt.close();
      const fault = await invoke(["verify", "--archive", archive]);
      expect(fault.exit).toBe(1);
      expect(fault.err).toContain("summary missing/downgraded");
      const after = new Database(join(archive, "state.sqlite"), {
        readonly: true,
      });
      expect(after.query("SELECT COUNT(*) AS n FROM attempts").get()).toEqual(
        before,
      );
      after.close();
    },
  );

test("inspect-app invalid finite budgets fail before root mutation", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "app-invalid-"));
  const archive = join(root, "absent");
  for (const n of ["0", "Infinity", "-1", "9007199254740992", "1.5"]) {
    await expect(
      main([
        "inspect-app",
        "--source",
        "austin",
        "--item",
        id,
        "--archive",
        archive,
        "--terms-sha256",
        "a".repeat(64),
        "--catalog-terms-sha256",
        "b".repeat(64),
        "--max-requests",
        n,
      ]),
    ).rejects.toThrow();
    expect(existsSync(archive)).toBe(false);
  }
});
