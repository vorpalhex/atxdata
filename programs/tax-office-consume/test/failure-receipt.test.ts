import {test,expect} from 'bun:test';import {join} from 'node:path';import {rm} from 'node:fs/promises';import {Collector} from '../src/collector';import {collect,retryable} from '../src/live';import {CAPS,ROUTES} from '../src/source';import {temp} from './collector.test';
test('cleanup aggregation preserves primary transient retry classification and terminal HTTP status',()=>{
 expect(retryable(200,new AggregateError([new TypeError('read fault'),new Error('close fault')]))).toBe(true);
 expect(retryable(null,new AggregateError([new DOMException('timeout','TimeoutError')]))).toBe(true);
 expect(retryable(null,new AggregateError([new DOMException('aborted','AbortError')]))).toBe(false);
 const named=new Error('not a DOM timeout');named.name='TimeoutError';expect(retryable(null,named)).toBe(false);
 expect(retryable(200,new AggregateError([new Error('primary permanent'),new TypeError('secondary release')]))).toBe(false);
 expect(retryable(403,new AggregateError([new TypeError('read fault')]))).toBe(false);
 expect(retryable(503,new Error('HTTP failure'))).toBe(true);
 for(const status of [500,599])expect(retryable(status,new Error('HTTP failure'))).toBe(true);
 for(const status of [499,600])expect(retryable(status,new Error('HTTP failure'))).toBe(false);
});
test('budget exhaustion retains the primary body failure without weakening byte reservations',async()=>{
 const base=await temp();let now=10000,csvCalls=0;const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async url=>{
 if(url===ROUTES.robots)return new Response('',{status:404});if(url===ROUTES.discovery)return new Response('/voterdata/TaxDelqOpenData.csv DelinquentFileLayout.php');csvCalls++;
 return new Response(new ReadableStream({pull(controller){controller.error(new TypeError('native primary read failure'));}}));
 }});
 try{await expect(collect(c,'delinquency',1,true)).rejects.toThrow('native primary read failure');expect(csvCalls).toBe(3);expect(c.status()).toMatchObject({complete:0,failed:1});
 const attempts=c.db.query<{bytes:number;error:string;http_status:number},[]>("SELECT bytes,error,http_status FROM attempts WHERE kind='csv'").all();expect(attempts).toHaveLength(3);
 for(const a of attempts){expect(a.bytes).toBe(CAPS.csv);expect(a.http_status).toBe(200);expect(a.error).toContain('native primary read failure');}
 expect(c.db.query<{error:string},[]>('SELECT error FROM runs').get()!.error).toContain('native primary read failure');
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
