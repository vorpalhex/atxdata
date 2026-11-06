import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {replay} from './collector.test';
test('transport attempt budget before catalog persists across process restart',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-attempt-')),deps=replay();let calls=0;
 const options={...deps,fetch:async()=>{calls++;throw new TypeError('transport failed');}};
 try{let c=await Collector.open(root,options);await expect(c.collect('125662')).rejects.toThrow();expect(calls).toBe(4);await c.close();
  c=await Collector.open(root,options);await expect(c.collect('125662')).rejects.toThrow('attempt budget exhausted');expect(calls).toBe(4);await c.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
