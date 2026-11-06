import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {replay} from './collector.test';
test('explicit refresh starts new provenance after failed checkpoint changes version; prior originals survive',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-refresh-')),deps=replay(),base=deps.fetch;let phase=0;
 const c=await Collector.open(root,{...deps,fetch:async(url)=>{
  if(url.endsWith('summary.json')&&phase===0)return new Response('broken',{headers:{'content-type':'application/json'}});
  if(url.endsWith('current_ver.txt')&&phase>0)return new Response('367566',{headers:{'content-type':'text/plain'}});
  return base(url);
 }});
 try{
  await expect(c.collect('125662')).rejects.toThrow();phase=1;
  await expect(c.collect('125662')).rejects.toThrow('checkpoint version changed');
  const result=await c.collect('125662',true);expect(result.coverage.versionBefore).toBe('367566');
  expect((await c.status()).observations).toBe(2);await c.verify();
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
