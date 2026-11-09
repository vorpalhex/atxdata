import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm} from "node:fs/promises";
import {join} from "node:path";
import {Engine} from "../src/engine";
import {Transport,cooldown} from "../src/transport";
import {sources} from "../src/adapters";
test("cooldowns include success, structured whitespace, dates, exhausted legacy and ambiguity",()=>{
 expect(cooldown(new Headers({"RateLimit":'"default"; r = 0 ; t = 12'}),1000)).toBe(13000);
 expect(cooldown(new Headers({"Retry-After":"5"}),1000)).toBe(6000);
 expect(cooldown(new Headers({"RateLimit-Remaining":"0","RateLimit-Reset":"10"}),1000)).toBe(11000);
 expect(cooldown(new Headers({"X-RateLimit-Remaining":"0","X-RateLimit-Reset":"20"}),1000)).toBe(20000);
 expect(()=>cooldown(new Headers({"RateLimit":'r=0;t=unknown'}),1000)).toThrow();
 expect(()=>cooldown(new Headers({"Retry-After":" "}),1000)).toThrow();
});
test("robots before discovery, durable complete-body pacing, private headers and failed reservations survive reopening",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"transport-test-")));
 let engine=await Engine.open(root),now=10000,calls:string[]=[];
 const fake=async(url:string)=>{
  calls.push(url);
  if(url.endsWith("robots.txt")) return new Response("User-agent: *\nDisallow: /private\nCrawl-delay: 3",{headers:{"Content-Type":"text/plain"}});
  return new Response(`<h2>FY 2030</h2><a href="/impact.pdf">Taxpayer Impact Statement</a>`,{headers:{"Content-Type":"text/html","RateLimit":'r=0; t = 5',"X-Robots-Tag":"noindex, noarchive"}});
 };
 try {
  const transport=new Transport(engine,{fetch:fake,now:()=>now,sleep:async ms=>{now+=ms;}});
  await transport.discover("budgets",sources.budgets.pages[0]);
  expect(calls).toEqual(["https://www.traviscountytx.gov/robots.txt",sources.budgets.pages[0]]);
  expect(engine.status().snapshots).toBe(1);
  const attempts=engine.db.query<{started:number;ended:number;bytes:number;headers:string},[]>("select * from attempts order by started").all();
  expect(attempts[1]!.started-attempts[0]!.ended).toBeGreaterThanOrEqual(3000);
  expect(attempts[1]!.headers).toContain("noarchive");
  const meta=engine.db.query<{headers:string|null},[]>("SELECT headers FROM snapshot_metadata").get()!;
  expect(meta.headers).toContain("noarchive");
  await engine.close();engine=await Engine.open(root);
  const failing=new Transport(engine,{fetch:async()=>{throw new Error("interrupted");},now:()=>now,sleep:async ms=>{now+=ms;}});
  await expect(failing.discover("budgets",sources.budgets.pages[1])).rejects.toThrow("interrupted");
  const failure=engine.db.query<{reservation:number;bytes:null},[]>("select * from attempts order by rowid desc limit 1").get()!;
  expect(failure.reservation).toBe(3*1024*1024);expect(failure.bytes).toBeNull();
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});
