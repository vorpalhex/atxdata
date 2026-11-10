import {test,expect} from 'bun:test';import {Collector} from '../src/collector';import {collect} from '../src/live';import {sample,pdf,temp} from './collector.test';import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';
test('semantic retained cache enforces caller byte bound before returning reuse',async()=>{
 const root=await temp();await writeFile(join(root,'data'),sample());await writeFile(join(root,'layout'),pdf);let calls=0;
 const c=await Collector.open(join(root,'archive'),{fetch:async()=>{calls++;throw Error('unexpected HTTP');}});
 try{await c.importRetained('delinquency',{csv:join(root,'data'),layout:join(root,'layout'),maxRows:1});await expect(collect(c,'delinquency',1,false,{maxBytes:1})).rejects.toThrow('byte ceiling');expect(calls).toBe(0);expect(await collect(c,'delinquency',1,false,{maxBytes:Buffer.byteLength(sample())})).toMatchObject({reused:true,rows:1});}finally{await c.close();await rm(root,{recursive:true,force:true});}
});
