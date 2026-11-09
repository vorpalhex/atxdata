import {test,expect} from 'bun:test';
import {rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {streamBody,releaseBody} from '../src/live';
import {temp} from './collector.test';
test('native EOF is not cancelled and open failure cancels once and releases its reader',async()=>{
 const base=await temp(),path=join(base,'body');let cancelled=0;
 const stream=new ReadableStream<Uint8Array>({cancel(){cancelled++;}}),response=new Response(stream);
 await writeFile(path+'.pending','occupied');
 try{let failure:unknown;try{await streamBody(response,path,20);}catch(error){failure=error;}
 expect(failure).not.toBeInstanceOf(AggregateError);expect((failure as NodeJS.ErrnoException).code).toBe('EEXIST');expect(cancelled).toBe(1);expect(stream.locked).toBe(false);}finally{await rm(base,{recursive:true,force:true});}
});
test('cleanup closes descriptor even when cancellation and release both fail, retaining both errors',async()=>{
 const calls:string[]=[],cancel=new Error('cancel fault'),release=new TypeError('release fault');
 const errors=await releaseBody({cancel:async()=>{calls.push('cancel');throw cancel;},releaseLock:()=>{calls.push('release');throw release;}},{close:async()=>{calls.push('close');}},false);
 expect(calls).toEqual(['cancel','release','close']);expect(errors).toEqual([cancel,release]);
});
test('EOF releases without cancellation, and close failure is retained',async()=>{
 const calls:string[]=[],close=new Error('close fault');
 const errors=await releaseBody({cancel:async()=>{calls.push('cancel');},releaseLock:()=>{calls.push('release');}},{close:async()=>{calls.push('close');throw close;}},true);
 expect(calls).toEqual(['release','close']);expect(errors).toEqual([close]);
});
