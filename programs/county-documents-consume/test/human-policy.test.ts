import {test,expect} from 'bun:test';
import {archiveScope} from '../src/archive-scope';
import {Engine} from '../src/engine';
import {Transport} from '../src/transport';
import {sources} from '../src/adapters';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';

test('anonymous archive scope remains tenant-only without a human override',()=>{
 expect(archiveScope('https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx')).toBe(true);
 for(const url of ['https://online.encodeplus.com/regs/other/','https://online.encodeplus.com/regs/traviscounty-tx-evil/','https://online.encodeplus.com/robots.txt','https://online.encodeplus.com.evil/regs/traviscounty-tx/','http://online.encodeplus.com/regs/traviscounty-tx/','https://name@online.encodeplus.com/regs/traviscounty-tx/','https://online.encodeplus.com:999/regs/traviscounty-tx/']) expect(archiveScope(url)).toBe(false);
});
for(const failure of ['challenge','status','interrupted'] as const) test(`direct requests preserve ${failure} stop and full accounting`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'direct-stop-'))),engine=await Engine.open(root);
 const url='https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx';
 let now=10000;const calls:string[]=[];
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(u:string)=>{
  calls.push(u); if(u.endsWith('/robots.txt')) throw Error('unexpected policy request');
  const body=failure==='interrupted'?new ReadableStream({start(c){c.error(Error('interrupted fixture'));}}):failure==='challenge'?'Verify you are human':'Unavailable';
  return new Response(body,{status:failure==='status'?403:200,headers:{'content-type':'text/html','retry-after':'9'}});
 }};
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],`<a href="${url}">Archives</a>`,'authored');
  await expect(new Transport(engine,deps,{maxRequests:1}).discover('county-code',url)).rejects.toThrow(failure==='status'?'HTTP 403':failure);
  expect(calls).toEqual([url]);
  expect(engine.db.query<{not_before:number},[]>('SELECT not_before FROM cooldowns').get()!.not_before).toBeGreaterThanOrEqual(19000);
  if(failure==='interrupted') expect(engine.db.query("SELECT bytes,reservation FROM attempts").get()).toEqual({bytes:null,reservation:3145728});
  const before=engine.status();
  await expect(new Transport(engine,deps).discover('county-code',url)).rejects.toThrow('stopped');
  expect(calls).toEqual([url]);expect(engine.status()).toEqual(before);
 }finally{await engine.close();await rm(root,{recursive:true,force:true});}
});
