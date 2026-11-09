import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm} from "node:fs/promises";
import {join} from "node:path";
import {Engine} from "../src/engine";
import {Transport} from "../src/transport";
import {sources} from "../src/adapters";
import {fixturePdf} from "./engine.test";
import {authoredLargePdf} from "./fixtures";
import {verifyTransportLedger} from '../src/transport-integrity';

test("operation budgets permit continued same-archive discovery and >2 PDFs without erasing policy/history",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"operations-")));
 let engine=await Engine.open(root),now=10000;
 const starts:number[]=[];
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  starts.push(now);
  if(url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow:',{headers:{'content-type':'text/plain'}});
  if(url.endsWith('.pdf')) return new Response(fixturePdf(),{headers:{'content-type':'application/pdf'}});
  return new Response('<a href="/a.pdf">Chapter 2 A</a><a href="/b.pdf">Chapter 2 B</a><a href="/c.pdf">Chapter 2 C</a>',{headers:{'content-type':'text/html','retry-after':'7'}});
 }};
 try {
  for(let i=0;i<4;i++) await new Transport(engine,deps).discover('county-code',sources['county-code'].pages[0]);
  const transport=new Transport(engine,deps);
  for(const row of engine.list('county-code',{limit:3})) await transport.collect(row.id);
  expect(engine.status()).toMatchObject({snapshots:4,versions:3,attempts:8});
  expect(await engine.verify('county-code',{limit:3})).toMatchObject({documents:3,httpRequests:0});
  expect(starts.every((start,i)=>i===0 || start-starts[i-1]!>=3000)).toBe(true);
  const previous=engine.status().attempts;
  await engine.close();engine=await Engine.open(root);
  const bounded=new Transport(engine,deps,{maxRequests:1,maxBytes:10*1024*1024});
  await bounded.discover('county-code',sources['county-code'].pages[0]);
  const persistedWait=engine.db.query<{n:number},[]>("SELECT not_before n FROM cooldowns").get()!.n;
  expect(persistedWait).toBeGreaterThanOrEqual(now+7000);
  await expect(bounded.discover('county-code',sources['county-code'].pages[0])).rejects.toThrow('operation');
  expect(engine.status().attempts).toBe(previous+1);
  engine.db.exec('SAVEPOINT corrupt');
  engine.db.run("UPDATE attempts SET reservation=reservation+1 WHERE kind='pdf'");
  expect(()=>verifyTransportLedger(engine)).toThrow('reservation');
  engine.db.exec('ROLLBACK TO corrupt; RELEASE corrupt');
  expect(starts.at(-1)!-starts.at(-2)!).toBeGreaterThanOrEqual(3000);
  expect(engine.db.query<{n:number},[]>("SELECT not_before n FROM cooldowns").get()!.n).toBe(persistedWait);
 } finally {await engine.close();await rm(root,{recursive:true,force:true});}
});

test('full authored PDF >5MiB imports and verifies; explicit smaller bound refuses',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"large-pdf-")));
 const engine=await Engine.open(root);
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],'<a href="/large.pdf">Chapter 2</a>','authored-test');
  const row=engine.list('county-code',{limit:1})[0]!;
  const large=authoredLargePdf();
  expect(large.length).toBeGreaterThan(5*1024*1024);
  await engine.importPdf(row.id,large,'application/pdf','authored-test');
  expect(await engine.verify('county-code',{limit:1})).toMatchObject({documents:1});
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});
test('collect persists complete >5MiB streamed fixture under explicit wire/PDF and aggregate budgets',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'large-collect-'))),engine=await Engine.open(root);
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],'<a href="/large.pdf">Chapter 2</a>','authored');
  const row=engine.list('county-code',{limit:1})[0]!,large=authoredLargePdf();
  let now=1000,offset=0;
  const transport=new Transport(engine,{now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
   if(url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow:',{headers:{'content-type':'text/plain'}});
   return new Response(new ReadableStream({pull(controller){if(offset===large.length) {controller.close();return;}const end=Math.min(offset+65536,large.length);controller.enqueue(large.subarray(offset,end));offset=end;}}),{headers:{'content-type':'application/pdf','content-length':String(large.length)}});
  }},{maxPdfBytes:7*1024*1024,maxBytes:10*1024*1024,maxRequests:2});
  await transport.collect(row.id);
  expect(offset).toBe(large.length);
  expect(await engine.verify('county-code',{limit:1})).toMatchObject({documents:1});
  const attempt=engine.db.query<{bytes:number;reservation:number},[]>("SELECT * FROM attempts WHERE kind='pdf'").get()!;
  expect(attempt.bytes).toBe(large.length);expect(attempt.reservation).toBe(7*1024*1024);
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});
