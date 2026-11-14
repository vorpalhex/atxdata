import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
test("retainCapture fences promotion after real awaited write and preserves exact POST-HOLD state", async () => {
  const seed = process.env.ORIGINAL_FAILED_CAPTURE_ROOT;
  if (!seed) throw Error("ORIGINAL_FAILED_CAPTURE_ROOT required");
  const base = await mkdtemp(
      join(process.env.TMPDIR!, "retention-write-hold-"),
    ),
    probe = join(base, "probe.ts"),
    result = join(base, "state.json");
  const code = `import {mock} from 'bun:test';import * as fs from 'node:fs/promises';import {readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import assert from 'node:assert/strict';const original={...fs};let engine:any,armed=false,atHold:any,httpRequests=0;globalThis.fetch=async()=>{httpRequests++;throw Error('unexpected HTTP');};
function snapshot(){const names=readdirSync(engine.root).sort();return{names,artifacts:Object.fromEntries(names.filter(n=>!n.startsWith('documents.sqlite')).map(n=>[n,{sha256:sha(readFileSync(join(engine.root,n))),mode:statSync(join(engine.root,n)).mode&511}])),tables:Object.fromEntries(engine.db.query(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\").all().map((r:any)=>[r.name,engine.db.query('SELECT * FROM '+r.name).all().sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]))};}
mock.module('node:fs/promises',()=>({...original,writeFile:async(...args:any[])=>{const value=await (original.writeFile as any)(...args);if(armed&&String(args[0]).endsWith('.part')){armed=false;engine.db.exec(\"UPDATE cooldowns SET blocked='operator hold after real awaited write'\");atHold=snapshot();}return value;}}));
const {Engine,captureSelectionHash,sha}=await import(${JSON.stringify(join(import.meta.dir, "../src/engine.ts"))});const {ORIGINAL_POLICY}=await import(${JSON.stringify(join(import.meta.dir, "../src/original-retention.ts"))});const root=${JSON.stringify(join(base, "archive"))};await original.cp(${JSON.stringify(seed)},root,{recursive:true});engine=await Engine.open(root);let error='';try{const row=engine.list('austin-election-publications',{limit:1})[0]!,attempt=engine.db.query(\"SELECT a.id,p.decoded_hash FROM attempts a JOIN representations p ON p.attempt=a.id WHERE a.kind='pdf'\").get();assert.equal(attempt.decoded_hash,'6f038ee872e1647dcd09cf7278cafc569ab3e3287d69b69a173bcb8e20a04944');armed=true;try{await engine.retainCapture({source:row.source,observation:row.id,captureAttempt:attempt.id,documentSha256:attempt.decoded_hash,selectionSha256:captureSelectionHash(row),bodyPolicy:ORIGINAL_POLICY});}catch(e){error=String(e);}const after=snapshot();writeFileSync(${JSON.stringify(result)},JSON.stringify({error,httpRequests,atHold,after,changedAfterHold:JSON.stringify(atHold)!==JSON.stringify(after)},null,2));assert.ok(atHold,'real write seam missed');assert.match(error,/held root/);assert.equal(httpRequests,0);assert.equal(after.tables.versions.length,0);assert.equal(after.tables.history.length,0);assert.deepEqual(after,atHold,'no FURTHER mutation after POST-HOLD snapshot');}finally{await engine.close();}`;
  await writeFile(probe, code);
  const child = Bun.spawn([process.execPath, probe], {
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exit, err).toBe(0);
  expect(out).toBe("");
  const state = JSON.parse(await readFile(result, "utf8"));
  expect(state.error).toContain("held root");
  expect(state.httpRequests).toBe(0);
  expect(state.changedAfterHold).toBe(false);
  expect(state.after).toEqual(state.atHold);
});
