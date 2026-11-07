import {test,expect} from 'bun:test';import {join} from 'node:path';import {rm} from 'node:fs/promises';import {Collector} from '../src/collector';import {collect} from '../src/live';import {ROUTES} from '../src/source';import {temp} from './collector.test';
for(const [status,body] of [[404,'Not found'],[404,'<html><title>404</title>Page not found</html>'],[200,'# no restrictions\nUser-agent: *\nAllow: /\nDisallow: ']] as const)test('recognized robots response permits only next discovery '+status+body,async()=>{
 const base=await temp();let now=10000,calls=0;const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async url=>{calls++;if(url===ROUTES.robots)return new Response(body,{status});throw new Error('STOP after robots');}});
 try{await expect(collect(c,'delinquency',1,true)).rejects.toThrow('STOP after robots');expect(calls).toBe(2);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
for(const body of ['User-agent: *\nDisallow: /','Crawl-delay: 4','Request-rate: 1/10','Unknown-rule: stop'])test('robots instructions remain operator reviewed '+body,async()=>{
 const base=await temp();let calls=0;const c=await Collector.open(join(base,'archive'),{fetch:async()=>{calls++;return new Response(body);}});
 try{await expect(collect(c,'delinquency',1,true)).rejects.toThrow('robots');expect(calls).toBe(1);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
