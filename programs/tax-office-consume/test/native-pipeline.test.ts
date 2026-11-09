import {test,expect} from 'bun:test';
import {join} from 'node:path';
for(const mode of ['success','503'])test('fresh-process native disk pipeline '+mode,async()=>{
 for(let iteration=0;iteration<2;iteration++){
  const child=Bun.spawn([process.execPath,join(import.meta.dir,'native-worker.ts'),mode],{stdout:'pipe',stderr:'pipe',env:{...process.env,TAX_KEEP_RUNTIME:''}});
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  expect(stderr).toBe('');expect(exit).toBe(0);const result=JSON.parse(stdout);expect(result.ok).toBe(true);expect(result.detached).toEqual([]);expect(result.calls).toBe(mode==='503'?4:5);
 }
},120000);
