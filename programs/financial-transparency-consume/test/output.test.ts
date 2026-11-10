import { test, expect } from 'bun:test';
import { writeOutput, OutputFailure, outputStatus } from '../src/output';
import { commandOf, information } from '../src/frontend';
import { runAcquisitionCli } from '../src/acquisition-cli';
test('delivery deadline bounds a writer that never completes',async()=>{
 try {await writeOutput('result',()=>new Promise<number>(()=>{}));throw new Error('expected deadline');}
 catch(error){expect(error).toBeInstanceOf(OutputFailure);expect((error as OutputFailure).timedOut).toBe(true);}
},7000);
test('command selection and information respect option values and terminator',()=>{
 for(const name of ['discover','collect','acquire','sync','verify-source']){
  expect(commandOf(['--source-archive',name,'status'])).toBe('status');
  expect(commandOf(['--source-archive='+name,'verify-source'])).toBe('verify-source');
  expect(commandOf(['--source-archive',name,'--',name])).toBeUndefined();
 }
 for(const args of [['--file','--help'],['--file=--help'],['--','--help'],['--','help','collect']])expect(information(args)).toBeUndefined();
 expect(information(['collect','--unknown','--help'])).toContain('collect');
});
test('acquisition render failure propagates once rather than recursively rendering errors',async()=>{
 let count=0;await expect(runAcquisitionCli(['--help'],()=>{count++;throw new Error('authored output failure');})).rejects.toThrow('authored output failure');expect(count).toBe(1);
});
test('checked writer handles partial bytes, backpressure, safe errors and domain EPIPE statuses',async()=>{
 const chunks:Buffer[]=[],text='é'.repeat(40000);let calls=0;
 await writeOutput(text,b=>{if(calls++===0)throw Object.assign(new Error('private'),{code:'EAGAIN'});const n=Math.min(73,b.length);chunks.push(Buffer.from(b.subarray(0,n)));return n;});
 expect(Buffer.concat(chunks).toString()).toBe(text+'\n');
 for(const code of ['EBADF','ENOSPC','EPIPE']){
  let count=0;try{await writeOutput('result',()=>{count++;throw Object.assign(new Error('/private/secret'),{code});});throw new Error('expected failure');}catch(e){expect(e).toBeInstanceOf(OutputFailure);expect(String(e)).not.toContain('secret');for(const exit of [0,1,2,3,4]){const lines:string[]=[];expect(outputStatus(e as OutputFailure,exit,s=>lines.push(s))).toBe(code==='EPIPE'?exit:1);expect(lines.length).toBe(code==='EPIPE'?0:1);}}expect(count).toBe(1);
 }
 await expect(writeOutput('x',()=>0)).rejects.toThrow(OutputFailure);
});

test('writer attempts preserve transient classification and reject every invalid progress shape', async () => {
 for (const code of ['EAGAIN','EWOULDBLOCK','EINTR']) {
  let attempts=0;const chunks:Buffer[]=[];
  await writeOutput('é',bytes=>{if(attempts++===0)throw Object.assign(new Error('private'),{code});chunks.push(Buffer.from(bytes));return bytes.length;});
  expect(attempts).toBe(2);expect(Buffer.concat(chunks).toString()).toBe('é\n');
 }
 for (const count of [0,-1,0.5,NaN,Infinity,3]) {
  let attempts=0;await expect(writeOutput('x',()=>{attempts++;return count;})).rejects.toBeInstanceOf(OutputFailure);expect(attempts).toBe(1);
 }
 const failure=new OutputFailure(false,true);
 await expect(writeOutput('x',()=>{throw failure;})).rejects.toBe(failure);
 await expect(writeOutput('x',()=>{throw null;})).rejects.toBeInstanceOf(OutputFailure);
});
