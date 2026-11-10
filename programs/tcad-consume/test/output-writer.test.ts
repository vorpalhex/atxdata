import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Isolate module mocks in a subprocess: domain/native tests retain real node:fs.
test('checked asynchronous writer: partial UTF8, retry, zero progress and error classification',()=>{
 const module=import.meta.dir+'/../src/frontend.ts';
 const code=`
 import {mock,test} from 'bun:test';
 import {strict as assert} from 'node:assert';
 let mode='partial',parts=[],calls=0;
 mock.module('node:fs',()=>({write:(fd,data,offset,length,done)=>{
  calls++;
  if(mode==='throw')throw Object.assign(new Error('private detail'),{code:'EBADF'});
  queueMicrotask(()=>{
   if(mode==='zero')return done(null,0);
   if(mode==='retry'&&calls===1)return done(Object.assign(new Error('again'),{code:'EAGAIN'}),0);
   if(mode.startsWith('error-')&&calls===2)return done(Object.assign(new Error('private detail'),{code:mode.slice(6)}),0);
   const n=Math.min(length,3);parts.push(Buffer.from(data.subarray(offset,offset+n)));done(null,n);
  });
 }}));
 const f=await import(${JSON.stringify(module)});
 const text='雪🙂é'.repeat(20)+'\\n';
 for(mode of ['partial','retry']){
  parts=[];calls=0;await f.writeOutput(text);assert.deepEqual(Buffer.concat(parts),Buffer.from(text));assert.ok(calls>20);
 }
 for(mode of ['zero','throw','error-EBADF','error-EPIPE','error-EIO']){
  parts=[];calls=0;let caught;try{await f.writeOutput(text);}catch(e){caught=e;}
  assert.equal(caught?.outputFailure,true);assert.equal(caught?.outputPending,false);
  assert.match(caught.message,/stdout delivery failed/);assert.ok(!caught.message.includes('private detail'));
  if(mode.startsWith('error-')){assert.equal(caught.code,mode.slice(6));assert.equal(Buffer.concat(parts).length,3);}
 }
 const old=console.error;let diagnostics=[];console.error=(s)=>diagnostics.push(s);
 try{
  process.exitCode=0;f.failure(Object.assign(new Error('domain'),{code:'EPIPE'}));assert.equal(process.exitCode,1);assert.equal(diagnostics.length,1);
  diagnostics=[];process.exitCode=0;f.failure(Object.assign(new Error('stdout'),{code:'EPIPE',outputFailure:true}));
  const tax=${JSON.stringify(module.includes('tax-office-consume'))};assert.equal(process.exitCode,tax?0:1);assert.equal(diagnostics.length,tax?0:1);
 }finally{console.error=old;process.exitCode=0;}
 test('isolated writer faults',()=>{});
 `;
 const root=mkdtempSync(join(process.env.TMPDIR!,'writer-faults-'));
 const fixture=join(root,'writer.test.ts');writeFileSync(fixture,code);
 const p=Bun.spawnSync([process.execPath,'test',fixture],{env:process.env,timeout:15000});
 if(p.exitCode)console.error(p.stderr.toString());
 expect(p.exitCode).toBe(0);expect(p.stderr.toString()).toContain('1 pass');expect(p.stderr.toString()).toContain('0 fail');
});
