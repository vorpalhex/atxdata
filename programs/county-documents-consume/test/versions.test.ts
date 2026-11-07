import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm,unlink} from "node:fs/promises";
import {join} from "node:path";
import {Engine} from "../src/engine";
import {Transport} from "../src/transport";
import {sources} from "../src/adapters";
import {fixturePdf} from "./engine.test";

test("fixture collection preserves changed versions, global wire receipts and zero-HTTP rerun",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"versions-test-"))),e=await Engine.open(root);
 let now=10000,revision=1,calls=0;
 try {
  const transport=new Transport(e,{fetch:async url=>{
   calls++;
   if(url.endsWith('robots.txt')) return new Response('User-agent: *\nDisallow:',{headers:{'Content-Type':'text/plain'}});
   if(url.endsWith('/county-code')) return new Response('<a href="/2.pdf">Chapter 2</a>',{headers:{'Content-Type':'text/html'}});
   return new Response(fixturePdf(`Travis County Chapter 2 revision ${revision}`),{headers:{'Content-Type':'application/pdf'}});
  },now:()=>now,sleep:async ms=>{now+=ms;}});
  await transport.discover('county-code',sources['county-code'].pages[0]);
  const row=e.list('county-code',{chapter:'2',limit:1})[0]!;
  await transport.collect(row.id);revision++;
  await transport.collect(row.id);
  expect(e.status().versions).toBe(2);
  expect(await e.verify('county-code',{chapter:'2',limit:1})).toMatchObject({versions:2,httpRequests:0});
  expect(calls).toBe(4);
  const wire=e.db.query<{wire_path:string},[]>("SELECT wire_path FROM representations WHERE representation='encoded-and-decoded' LIMIT 1").get()!;
  await unlink(join(root,wire.wire_path));
  await expect(e.verify('county-code',{chapter:'2',limit:1})).rejects.toThrow();
  expect(calls).toBe(4);
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
