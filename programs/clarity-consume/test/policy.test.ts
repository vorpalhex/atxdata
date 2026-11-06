import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {replay} from './collector.test';
test('ambiguous successful server cooldown persists a stop gate, not a silently ignored instruction',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-policy-')),deps=replay();let calls=0;
 const c=await Collector.open(root,{...deps,fetch:async()=>{calls++;return new Response('User-agent: *',{headers:{'content-type':'text/plain','retry-after':'later'}});}});
 try{
  await expect(c.collect('125662')).rejects.toThrow('ambiguous');expect((await c.status()).notBefore).toBe(Number.MAX_SAFE_INTEGER);
  await expect(c.collect('125662')).rejects.toThrow('operator review');expect(calls).toBe(1);
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
