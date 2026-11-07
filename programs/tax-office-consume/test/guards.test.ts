import {test,expect} from 'bun:test';import {join} from 'node:path';import {writeFile,rm,symlink} from 'node:fs/promises';import {Collector} from '../src/collector';import {collect} from '../src/live';import {sample,pdf,temp} from './collector.test';import {ROUTES} from '../src/source';
test('writer contention and symlink artifacts reject without clobber',async()=>{
 const base=await temp(),root=join(base,'archive'),c=await Collector.open(root);
 try{await expect(Collector.open(root)).rejects.toThrow();await writeFile(join(base,'input.csv'),sample());await writeFile(join(base,'layout.pdf'),pdf);await c.importRetained('delinquency',{csv:join(base,'input.csv'),layout:join(base,'layout.pdf'),maxRows:1});const a=c.db.query<{path:string},[]>('SELECT path FROM artifacts LIMIT 1').get()!;await rm(join(root,a.path));await symlink(join(base,'input.csv'),join(root,a.path));await expect(c.verify()).rejects.toThrow();}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('interruption before the final checkpoint resumes both artifact hashes only',async()=>{
 const base=await temp(),root=join(base,'archive');let c=await Collector.open(root);const {id,run}=c.start('delinquency',1,'retained');await c.retain(id,run,'csv',sample());await c.close();c=await Collector.open(root);
 try{expect(c.status().failed).toBe(1);expect(c.status().complete).toBe(0);await writeFile(join(base,'input.csv'),sample());await writeFile(join(base,'layout.pdf'),pdf);await c.importRetained('delinquency',{csv:join(base,'input.csv'),layout:join(base,'layout.pdf'),maxRows:1});expect((await c.verify()).rows).toBe(1);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('retry is bounded and cooldown survives reopening including ambiguous successful policy',async()=>{
 const base=await temp(),root=join(base,'archive');let calls=0,now=10000;
 let c=await Collector.open(root,{now:()=>now,sleep:async n=>{now+=n;},fetch:async()=>{calls++;return new Response('outage',{status:503,headers:{'Retry-After':'4'}});}});
 try{await expect(collect(c,'delinquency',1,false)).rejects.toThrow('HTTP 503');expect(calls).toBe(4);expect(c.db.query('SELECT count(*) n FROM attempts').get()).toEqual({n:4});}finally{await c.close();}
 c=await Collector.open(root,{now:()=>now,sleep:async n=>{now+=n;},fetch:async()=>new Response('',{headers:{RateLimit:'"p";r=0'}})});
 try{await expect(collect(c,'delinquency',1,false)).rejects.toThrow('ambiguous');expect(c.status().cooldown).toBe(Number.MAX_SAFE_INTEGER);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('native streamed full-body ownership completes before the next request starts',async()=>{
 const base=await temp();let active=0,peak=0,calls=0;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>{calls++;active++;peak=Math.max(active,peak);return new Response(new ReadableStream({async start(controller){await Bun.sleep(5);controller.enqueue(new TextEncoder().encode('failure'));active--;controller.close();}}),{status:503});}});
 let now=10000;const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async(_url,init)=>Bun.fetch(server.url,{...init})});
 try{await expect(collect(c,'delinquency',1,false)).rejects.toThrow('HTTP 503');expect(calls).toBe(4);expect(peak).toBe(1);}finally{server.stop(true);await c.close();await rm(base,{recursive:true,force:true});}
});
