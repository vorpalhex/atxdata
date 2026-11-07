import {test,expect} from 'bun:test';import {join} from 'node:path';import {rm} from 'node:fs/promises';import {streamBody} from '../src/live';import {temp} from './collector.test';
test('read failure remains the primary cause when release also fails, without cancelling an errored stream',async()=>{
 const base=await temp(),primary=new TypeError('primary read fault'),secondary=new TypeError('release fault');let cancelled=0;
 // Deliberate cleanup fault injection only; native pipeline tests never replace readers.
 const response={body:{getReader:()=>({read:async()=>{throw primary;},cancel:async()=>{cancelled++;},releaseLock:()=>{throw secondary;}})}} as unknown as Response;
 try{let error:unknown;try{await streamBody(response,join(base,'body'),20);}catch(e){error=e;}
 expect(error).toBeInstanceOf(AggregateError);const aggregate=error as AggregateError;expect(aggregate.cause).toBe(primary);expect(aggregate.errors).toEqual([primary,secondary]);expect(aggregate.message).toContain('primary read fault');expect(aggregate.message).toContain('release fault');expect(cancelled).toBe(0);
 }finally{await rm(base,{recursive:true,force:true});}
});
test('exact body cap and EOF release succeed without even calling reader cancellation',async()=>{
 const base=await temp();let cancellations=0;const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(20));c.close();}}),getReader=body.getReader.bind(body);
 body.getReader=(()=>{const reader=getReader();reader.cancel=async()=>{cancellations++;throw new Error('unexpected EOF cancellation');};return reader;}) as typeof body.getReader;
 try{expect(await streamBody(new Response(body),join(base,'body'),20)).toBe(20);expect(cancellations).toBe(0);expect(body.locked).toBe(false);}finally{await rm(base,{recursive:true,force:true});}
});
test('release failure after EOF is surfaced without inventing a primary transfer error',async()=>{
 const base=await temp(),secondary=new TypeError('release after EOF fault');
 const response={body:{getReader:()=>({read:async()=>({done:true}),cancel:async()=>{throw new Error('must not cancel');},releaseLock:()=>{throw secondary;}})}} as unknown as Response;
 try{let error:unknown;try{await streamBody(response,join(base,'body'),20);}catch(e){error=e;}
 expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([secondary]);expect((error as AggregateError).cause).toBeUndefined();
 }finally{await rm(base,{recursive:true,force:true});}
});
test('byte ceiling cancels unfinished input once and releases the lock, never producing a success',async()=>{
 const base=await temp();let cancelled=0;const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(21));},cancel(){cancelled++;}});
 try{await expect(streamBody(new Response(body),join(base,'body'),20)).rejects.toThrow('stream byte ceiling');expect(cancelled).toBe(1);expect(body.locked).toBe(false);}finally{await rm(base,{recursive:true,force:true});}
});
