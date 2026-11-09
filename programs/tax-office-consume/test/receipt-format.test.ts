import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {Collector} from '../src/collector';import {collect} from '../src/live';import {CAPS} from '../src/source';
function missingStack(error:Error,label:string){error.stack=`Error\n    at ${label} (fixture:1:1)`;return error;}
for(const kind of ['plain','aggregate','cause-only'])test('persist explicit error identity/message independently of stack: '+kind,async()=>{
 const primary=missingStack(new TypeError('native primary read failure'),'primary_frame');
 const cleanup=missingStack(new Error('cleanup failure'),'cleanup_frame');
 const error=kind==='plain'?primary:missingStack(new AggregateError(kind==='aggregate'?[primary,cleanup]:[],'aggregate transfer failure',{cause:primary}),'aggregate_frame');
 const base=await mkdtemp(join(process.env.TMPDIR!,'receipt-format-'));let now=10000,calls=0;
 const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async()=>{calls++;throw error;}});
 try{await expect(collect(c,'delinquency',1,true)).rejects.toThrow(kind==='plain'?'native primary read failure':'aggregate transfer failure');
 const attempts=c.db.query<{error:string;bytes:number;http_status:number|null},[]>('SELECT error,bytes,http_status FROM attempts').all();expect(attempts).toHaveLength(kind==='cause-only'?1:4);expect(calls).toBe(attempts.length);
 for(const a of attempts){expect(a.error).toContain('TypeError: native primary read failure');expect(a.error).toContain('primary_frame');expect(a.bytes).toBe(CAPS.robots);expect(a.http_status).toBeNull();
 if(kind!=='plain'){expect(a.error).toContain('AggregateError: aggregate transfer failure');expect(a.error).toContain('aggregate_frame');}if(kind==='aggregate'){expect(a.error).toContain('Error: cleanup failure');expect(a.error).toContain('cleanup_frame');}}
 expect(c.status()).toMatchObject({complete:0,failed:1});
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
