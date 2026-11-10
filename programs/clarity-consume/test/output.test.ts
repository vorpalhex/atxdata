import { test, expect } from 'bun:test';
import { writeOutput, OutputFailure, outputStatus } from '../src/output';
import { information } from '../src/frontend';
test('delivery deadline bounds a writer that never completes',async()=>{
 try {await writeOutput('result',()=>new Promise<number>(()=>{}));throw new Error('expected deadline');}
 catch(error){expect(error).toBeInstanceOf(OutputFailure);expect((error as OutputFailure).timedOut).toBe(true);}
},7000);
test('information respects required values, terminator, precedence and unknown options',()=>{
 for(const args of [['--archive','--help'],['--archive=--help'],['--','--help'],['--','help','collect']])expect(information(args)).toBeUndefined();
 expect(information(['collect','--unknown','--help'])).toContain('collect');
 expect(information(['--version'])).toBe('clarity-consume 0.1.0');
});
test('checked output preserves bytes across short writes and bounded retries, redacts failures',async()=>{
 const chunks:Buffer[]=[],text='é'.repeat(40000);let attempts=0;
 await writeOutput(text,b=>{if(attempts++===0)throw Object.assign(new Error('private'),{code:'EAGAIN'});const n=Math.min(73,b.length);chunks.push(Buffer.from(b.subarray(0,n)));return n;});
 expect(Buffer.concat(chunks).toString()).toBe(text+'\n');
 for(const code of ['EBADF','ENOSPC','EPIPE']){
  let count=0;try{await writeOutput('result',()=>{count++;throw Object.assign(new Error('/private/secret'),{code});});throw new Error('expected failure');}catch(e){expect(e).toBeInstanceOf(OutputFailure);expect(String(e)).not.toContain('secret');const diagnostics:string[]=[];expect(outputStatus(e as OutputFailure,s=>diagnostics.push(s))).toBe(code==='EPIPE'?0:1);expect(diagnostics.length).toBe(code==='EPIPE'?0:1);}expect(count).toBe(1);
 }
 await expect(writeOutput('x',()=>0)).rejects.toThrow(OutputFailure);
});
