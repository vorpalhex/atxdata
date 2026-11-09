import {test,expect} from 'bun:test';import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';import {Collector} from '../src/collector';import {collect} from '../src/live';import {sample,pdf,temp} from './collector.test';
test('zero elapsed millisecond completion is valid and explicitly bound',async()=>{
 const base=await temp(),c=await Collector.open(join(base,'archive'),{now:()=>10000});await writeFile(join(base,'csv'),sample());await writeFile(join(base,'pdf'),pdf);
 try{await c.importRetained('delinquency',{csv:join(base,'csv'),layout:join(base,'pdf'),maxRows:1});expect((await c.verify()).rows).toBe(1);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('robots redirect may not redirect again even to the same official missing-page route',async()=>{
 const base=await temp();let calls=0,now=10000;const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async()=>{calls++;return new Response('',{status:302,headers:{Location:'/404'}});}});
 try{await expect(collect(c,'delinquency',1,true)).rejects.toThrow('redirect');expect(calls).toBe(2);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
