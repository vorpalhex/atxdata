import {test,expect} from 'bun:test';
import {rm} from 'node:fs/promises';import {join} from 'node:path';
import {Collector} from '../src/collector';import {collect,serverDelay} from '../src/live';import {sample,pdf,temp} from './collector.test';import {ROUTES} from '../src/source';
test('bounded selected live snapshot serializes bodies and persists successful cooldowns; offline reuse has zero HTTP',async()=>{
 const base=await temp();let now=100000,calls:string[]=[],lastEnd=0;
 const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async ms=>{now+=ms;},random:()=>0,fetch:async url=>{
  expect(now-lastEnd).toBeGreaterThanOrEqual(2000);calls.push(url);lastEnd=now;
  if(url===ROUTES.robots)return new Response('',{status:404});
  if(url===ROUTES.discovery)return new Response('<a href="/voterdata/TaxDelqOpenData.csv">CSV</a><a href="/pages/DelinquentFileLayout.php">layout</a>');
  return new Response(url===ROUTES.csv?sample():pdf,{headers:{'Retry-After':'7','Content-Type':url===ROUTES.csv?'text/csv':'application/octet-stream'}});
 }});
 try{expect((await collect(c,'delinquency',1,false)).rows).toBe(1);expect(calls).toHaveLength(4);expect(c.status().cooldown).toBeGreaterThanOrEqual(now+7000);await collect(c,'delinquency',1,false);expect(calls).toHaveLength(4);expect((await c.verify()).snapshots).toBe(1);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('policy handles structured whitespace and rejects ambiguity rather than shortening cooldown',()=>{
 expect(serverDelay(new Headers({'RateLimit':'"p"; r = 0 ; t = 12 '}),0)).toBe(12000);
 expect(()=>serverDelay(new Headers({'RateLimit':'"p";r=0'}),0)).toThrow('ambiguous');
});
test('real gate is recorded, lone data never completes and byte reservation survives failure',async()=>{
 const base=await temp();const c=await Collector.open(join(base,'archive'),{fetch:async()=>new Response('login',{status:403})});
 try{await expect(collect(c,'delinquency',1,false)).rejects.toThrow('HTTP 403');expect(c.status().complete).toBe(0);expect((c.db.query('SELECT bytes FROM attempts').get() as {bytes:number}).bytes).toBeGreaterThan(0);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
