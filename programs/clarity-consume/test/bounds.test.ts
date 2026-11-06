import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {replay} from './collector.test';
async function withCollector(override:(url:string,base:(url:string)=>Promise<Response>)=>Promise<Response>,check:(c:Collector,root:string,calls:string[])=>Promise<void>){
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-bounds-')),deps=replay();const c=await Collector.open(root,{...deps,fetch:url=>override(url,deps.fetch)});
 try{await check(c,root,deps.calls);}finally{await c.close();await rm(root,{recursive:true,force:true});}
}
test('version races retain explicit disagreement and offline coverage corruption fails verification',async()=>{
 let versions=0;
 await withCollector(async(url,base)=>url.endsWith('current_ver.txt')&&++versions===2?new Response('367566',{headers:{'content-type':'text/plain'}}):base(url),async(c)=>{
  const r=await c.collect('125662');expect(r.coverage.stable).toBe(false);expect(r.coverage.mismatches).toContain('version changed during observation');await c.verify();
  c.db.query("UPDATE observations SET coverage=json_set(coverage,'$.mismatches',json('[]'))").run();await expect(c.verify()).rejects.toThrow();
 });
});
test('declared and streamed byte bounds stop acquisition without promotion or retry',async()=>{
 for(const declared of [true,false])await withCollector(async(url,base)=>{
  if(!url.endsWith('summary.json'))return base(url);
  return new Response(new Uint8Array(12_000_001),{headers:{'content-type':'application/json',...(declared?{'content-length':'12000001'}:{})}});
 },async(c,root)=>{
  await expect(c.collect('125662')).rejects.toThrow('byte ceiling');
  expect(c.db.query("SELECT count(*) n FROM files WHERE name='summary'").get()).toEqual({n:1});
  expect(c.db.query("SELECT count(*) n FROM files WHERE name='summary' AND status='downloaded'").get()).toEqual({n:0});
 });
});
test('malformed version and robots policy changes stop before result routes',async()=>{
 for(const mode of ['version','robots'])await withCollector(async(url,base)=>{
  if(mode==='version' && url.endsWith('current_ver.txt'))return new Response('../367565',{headers:{'content-type':'text/plain'}});
  if(mode==='robots' && url.endsWith('robots.txt'))return new Response('User-agent: *\nDisallow: /',{headers:{'content-type':'text/plain'}});
  return base(url);
 },async(c,root,calls)=>{await expect(c.collect('125662')).rejects.toThrow();expect(calls.some(x=>x.includes('/json/'))).toBe(false);});
});
