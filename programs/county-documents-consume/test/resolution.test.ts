import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm} from "node:fs/promises";
import {join} from "node:path";
import {Engine} from "../src/engine";
import {Transport} from "../src/transport";
import {verifyRepresentations} from "../src/archive-verification";
import {sources} from "../src/adapters";

test("explicit local-classifier resolution adopts only retained decoded robots and preserves failed attempt/gate receipt",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"resolution-test-")));
 const engine=await Engine.open(root);
 try {
  const body=Buffer.from("User-agent: *\nDisallow: /private\n");
  const artifact=await engine.artifact(body,"html"),run=engine.start("budgets","robots");
  const headers=JSON.stringify([["content-type","text/plain"],["content-encoding","br"],["content-length","12"]]);
  engine.db.run("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",["old",run,"https://www.traviscountytx.gov/robots.txt","robots",1000,1100,200,3145728,body.length,artifact.hash,headers,"Error: Content-Length mismatch"]);
  engine.db.run("UPDATE cooldowns SET blocked='unfinished attempt requires operator review',not_before=3100");
  let calls=0,now=10000;
  const transport=new Transport(engine,{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async()=>{calls++;return new Response('<h2>FY 2030</h2><a href="/tax.pdf">Taxpayer Impact Statement</a>',{headers:{"Content-Type":"text/html"}});}});
  await transport.resolveDecodedRobots("old","operator continuation; local regression tests green");
  const old=engine.db.query<{error:string;headers:string},[]>("SELECT * FROM attempts WHERE id='old'").get()!;
  expect(old.error).toBe("Error: Content-Length mismatch");expect(old.headers).toBe(headers);
  expect(engine.db.query<{previous_gate:string},[]>("SELECT previous_gate FROM classifier_resolutions").get()!.previous_gate).toContain("unfinished attempt");
  await transport.discover("budgets",sources.budgets.pages[0]);
  expect(calls).toBe(1);
  expect(engine.status().attempts).toBe(2);
  await verifyRepresentations(engine);
  for(const sql of ["DELETE FROM representations WHERE attempt='old'","DELETE FROM classifier_resolutions","UPDATE attempts SET status=503,error=NULL WHERE id='old'","UPDATE attempts SET reservation=1237 WHERE id='old'","UPDATE classifier_resolutions SET reason=''","UPDATE representations SET wire_bytes=0 WHERE attempt='old'"]) {
   engine.db.exec('SAVEPOINT negative');
   engine.db.exec(sql);
   await expect(verifyRepresentations(engine)).rejects.toThrow();
   engine.db.exec('ROLLBACK TO negative; RELEASE negative');
  }
  await verifyRepresentations(engine);
  engine.db.run("UPDATE attempts SET bytes=16777216 WHERE id<>'old'");
  await expect(transport.discover("budgets",sources.budgets.pages[1])).rejects.toThrow("budget");
  expect(calls).toBe(1);
  await expect(transport.resolveDecodedRobots("old","duplicate")).rejects.toThrow();
 }finally{await engine.close();await rm(root,{recursive:true,force:true});}
});
