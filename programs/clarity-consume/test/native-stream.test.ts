import {test,expect} from 'bun:test';
import {mkdtemp,realpath,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {multiReplay} from './multi-election.test';
for(const kind of ['EOF','read-error','overflow','cancel-error','release-error'])test('native reader cleanup '+kind,async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-ownership-'));
 const c=await Collector.open(root);let cancel=0,release=0;
 const reader={read:async()=>{if(kind==='read-error')throw Error('read');return kind==='EOF'?{done:true}:{done:false,value:new Uint8Array(10)};},cancel:async()=>{cancel++;if(kind==='cancel-error')throw Error('cancel');},releaseLock:()=>{release++;if(kind==='release-error')throw Error('release');}};
 try{
  const before=(await readdir('/dev/fd')).length;
  let error:any;try{await (c as any).consume({headers:new Headers(),body:{getReader:()=>reader}},join(root,'body'),5,'probe');}catch(e){error=e;}
  expect((await readdir('/dev/fd')).length).toBe(before);
  expect(cancel).toBe(['EOF','read-error'].includes(kind)?0:1);expect(release).toBe(1);
  if(kind==='EOF')expect(error).toBeUndefined();
  else if(['cancel-error','release-error'].includes(kind)){
   expect(error).toBeInstanceOf(AggregateError);expect(String(error.cause)).toContain('stream byte ceiling');
   expect(error.errors.length).toBe(2);expect(error.errors[0]).toBe(error.cause);expect(String(error.errors[1])).toContain(kind==='cancel-error'?'cancel':'release');
  }else expect(String(error)).toContain(kind==='read-error'?'read':'stream byte ceiling');
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
test('native localhost bodies lock before filesystem awaits and do not cancel after EOF',async()=>{
 const base=multiReplay(),server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  const url=new URL(req.url).searchParams.get('url')!;
  if(url.endsWith('clarityelections.com/robots.txt'))return new Response('x'.repeat(2616),{status:404,headers:{'content-type':'text/html','content-length':'2616'}});
  const r=await base.fetch(url);
  if(url.includes('election-results-and-reconciliation-forms'))return new Response((await r.text())+' '.repeat(228759),{headers:{'content-type':'text/html'}});
  return r;
 }});
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-native-'));let clock=0,calls=0;
 const c=await Collector.open(root,{now:()=>clock,sleep:async ms=>{clock+=ms;},random:()=>0,fetch:(url,init)=>{calls++;return Bun.fetch(`http://127.0.0.1:${server.port}/?url=${encodeURIComponent(url)}`,{...init,decompress:false});}});
 try{await c.collect('009876');await c.verify();await c.collectDate('2026-11-03');expect(calls).toBe(12);}finally{await c.close();server.stop(true);await rm(root,{recursive:true,force:true});}
});
