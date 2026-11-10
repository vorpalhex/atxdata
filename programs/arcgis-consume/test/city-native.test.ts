import {test,expect} from "bun:test";
import {mkdtemp,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {id,item} from "./support/city-fixture";
import {terms} from "../src/rules";
test("spawned city CLI collects 1201 native synthetic rows beyond proof bound and verifies/reuses offline",async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,"city-native-scale-")),archive=join(root,"archive"),preload=join(root,"fixture.ts");
 await writeFile(preload,`import {cityFixture} from ${JSON.stringify(resolve(import.meta.dir,"support/city-fixture.ts"))}; const f=cityFixture(1201);globalThis.fetch=f.deps.fetch;Date.now=f.deps.now;Bun.sleep=f.deps.sleep;`);
 const cli=resolve(import.meta.dir,"../src/cli.ts");
 const invoke=async(args:string[],fixture=false)=>{
  const p=Bun.spawn([process.execPath,...(fixture?["--preload",preload]:[]),cli,...args],{stdout:"pipe",stderr:"pipe"});
  const [stdout,stderr,exit]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  return {stdout,stderr,exit};
 };
 const args=["collect","--source","austin","--item",id,"--layer","7","--max-records","5000","--archive",archive,"--terms-sha256",terms(item).sha256];
 const result=await invoke(args,true);
 expect(result.stderr).toBe("");expect(result.exit).toBe(0);
 expect(JSON.parse(result.stdout).summary.records).toBe(1201);
 const verified=await invoke(["verify","--archive",archive]);
 expect(verified.stderr).toBe("");expect(verified.exit).toBe(0);
 const reused=await invoke(args);expect(reused.stderr).toBe("");expect(reused.exit).toBe(0);
 expect(JSON.parse(reused.stdout).reused).toBe(true);
 await writeFile(join(root,"receipts.json"),JSON.stringify({result,verified,reused},null,2));
});
