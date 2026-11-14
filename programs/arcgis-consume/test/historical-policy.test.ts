import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { main } from "../src/cli";
import { Archive } from "../src/archive";
import { verifyProfilePolicy } from "../src/profile-policy";
import { terms } from "../src/rules";
import {
  profileFixture,
  city,
  water,
  id,
  item,
} from "./support/profile-fixture";

for (const source of ["austin", "water"] as const) {
  test(`${source} admits actual tenant routes beneath a denied root`, async () => {
    const base = source === "austin" ? city : water;
    const f = profileFixture(
      source,
      `User-agent: *\nDisallow: /\nAllow: ${new URL(base).pathname}\n`,
    );
    const root = await mkdtemp(join(process.env.TMPDIR!, "root-allow-"));
    const result = await main(args(root, source), f.deps);
    expect((result as any).summary.records).toBe(13);
    expect(f.calls).not.toContain(new URL(base).origin + "/");
  });
}
function args(root: string, source: string) {
  return [
    "collect",
    "--source",
    source,
    "--item",
    id,
    "--layer",
    "7",
    "--archive",
    root,
    "--terms-sha256",
    terms(item).sha256,
  ];
}
async function evidence(root: string) {
  const db = new Database(join(root, "state.sqlite"), { readonly: true });
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all();
  const logical = tables.map(({ name }) => [
    name,
    db.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
  ]);
  db.close();
  const files: Record<string, string> = {};
  for (const name of (await readdir(root)).sort()) {
    if (name.endsWith("-shm") || name === ".archive.lock") continue;
    const bytes = await readFile(join(root, name));
    files[name] = createHash("sha256").update(bytes).digest("hex");
  }
  return { logical, files };
}
const producer = process.env.ARCGIS_HISTORICAL_PRODUCER;
const nativeTest = producer ? test : test.skip;
nativeTest(
  "native old completed policy admissions reject five denials and retain allowed controls without fetch or durable changes",
  async () => {
    const scratch = await mkdtemp(
      join(process.env.TMPDIR!, "historical-policy-"),
    );
    const preload = join(scratch, "fixture.ts"),
      calls = join(scratch, "calls.jsonl");
    const fixture = resolve(import.meta.dir, "support/profile-fixture.ts");
    await writeFile(
      preload,
      `import {appendFileSync} from 'node:fs';import {profileFixture,city,water} from ${JSON.stringify(fixture)};
process.on('exit',()=>Bun.gc(true));
const source=process.env.CASE_SOURCE;const mode=process.env.CASE_MODE;const base=source==='austin'?city:water;const route=new URL(base+'/7/query').pathname;
let policy='User-agent: *\\nAllow: /\\n';
if(mode==='deny')policy='User-agent: *\\nDisallow: '+route+'\\n';
if(mode==='agent')policy='User-agent: *\\nAllow: /\\n\\nUser-agent: atxdata-arcgis\\nDisallow: '+route+'\\n';
if(mode==='longer')policy='User-agent: *\\nDisallow: /\\nAllow: '+new URL(base).pathname+'\\n';
const f=profileFixture(source,mode==='missing'?new Response('Not found',{status:404}):mode==='unavailable'?new Response('Invalid URL',{status:403}):policy);Date.now=f.deps.now;Bun.sleep=f.deps.sleep;
globalThis.fetch=async(url,init)=>{appendFileSync(${JSON.stringify(calls)},JSON.stringify({url,agent:new Headers(init?.headers).get('user-agent')})+'\\n');if(process.env.CASE_OFFLINE==='1')throw Error('offline forbids fetch');if(mode==='shared'&&url==='https://www.arcgis.com/robots.txt')return new Response('User-agent: *\\nDisallow: /sharing/\\n');return f.deps.fetch(url)};`,
    );
    await writeFile(calls, "");
    for (const source of ["austin", "water"]) {
      for (const mode of [
        "deny",
        "agent",
        "allow",
        "longer",
        "unavailable",
        "missing",
        ...(source === "austin" ? ["shared"] : []),
      ]) {
        const root = join(scratch, source + "-" + mode);
        const invoke = async (
          cli: string,
          argv: string[],
          offline: boolean,
        ) => {
          const command = [
            process.execPath,
            "--preload",
            preload,
            cli,
            ...argv,
          ];
          const p = Bun.spawn(command, {
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              CASE_SOURCE: source,
              CASE_MODE: mode,
              CASE_OFFLINE: offline ? "1" : "0",
            },
          });
          const [stdout, stderr, exit] = await Promise.all([
            new Response(p.stdout).text(),
            new Response(p.stderr).text(),
            p.exited,
          ]);
          const result = {
            command,
            source,
            mode,
            offline,
            stdout,
            stderr,
            exit,
          };
          await writeFile(
            join(
              scratch,
              `receipt-${source}-${mode}-${offline ? argv[0] : cli === producer ? "producer" : "fresh"}.json`,
            ),
            JSON.stringify(result, null, 2),
          );
          return result;
        };
        // Await process exit BEFORE opening/hashing SQLite: retirement must precede the baseline.
        const produced = await invoke(producer!, args(root, source), false);
        expect(produced.exit).toBe(0);
        expect(JSON.parse(produced.stdout).summary.records).toBe(13);
        if (mode === "longer") {
          const fresh = await invoke(
            resolve(import.meta.dir, "../src/cli.ts"),
            args(root + "-fresh", source),
            false,
          );
          expect(fresh.exit).toBe(0);
          expect(JSON.parse(fresh.stdout).summary.records).toBe(13);
        }
        const direct = await Archive.open(root);
        const run = direct.store.observations()[0]!.run;
        try {
          if (["deny", "agent", "shared", "missing"].includes(mode))
            await expect(verifyProfilePolicy(direct, run)).rejects.toThrow(
              "historical robots",
            );
          else await verifyProfilePolicy(direct, run);
        } finally {
          await direct.close();
        }
        Bun.gc(true);
        const before = await evidence(root),
          beforeCalls = await readFile(calls, "utf8");
        for (const argv of [
          ["verify", "--archive", root],
          args(root, source),
        ]) {
          const result = await invoke(
            resolve(import.meta.dir, "../src/cli.ts"),
            argv,
            true,
          );
          if (["deny", "agent", "shared"].includes(mode)) {
            expect(result.exit).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.stderr).toContain(
              "historical robots disallows route",
            );
          } else if (mode === "missing") {
            expect(result.exit).toBe(1);
            expect(result.stderr).toContain(
              "historical robots admission evidence missing; operator review required",
            );
          } else {
            expect(result.exit).toBe(0);
          }
          expect(await evidence(root)).toEqual(before);
          expect(await readFile(calls, "utf8")).toBe(beforeCalls);
        }
      }
    }
  },
  120000,
);
