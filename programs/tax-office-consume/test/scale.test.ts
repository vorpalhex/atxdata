import {test,expect} from 'bun:test';
import {run} from '../src/cli';
import {HEADER,parseCsv} from '../src/source';
import {sample,pdf,temp} from './collector.test';
import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';
test('positive configurable budgets admit complete >4MiB >50000-row retained snapshot through CLI',async()=>{
 const base=await temp(),csv=join(base,'large.csv'),layout=join(base,'layout.pdf'),output=join(base,'archive');
 const row=sample().toString().split('\r\n')[1]!+'Synthetic legal description padding',count=50001;
 const raw=Buffer.from(HEADER.join(',')+'\r\n'+(row+'\r\n').repeat(count));expect(raw.length).toBeGreaterThan(4*1024**2);
 await writeFile(csv,raw);await writeFile(layout,pdf);
 try{
  const args=['import','--selection','delinquency','--max-rows',String(count),'--max-bytes',String(raw.length),'--csv',csv,'--layout',layout,'--output',output];
  const child=Bun.spawn([process.execPath,join(import.meta.dir,'../src/cli.ts'),...args],{stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(stderr).toBe('');expect(exit).toBe(0);expect(JSON.parse(stdout)).toMatchObject({rows:count,reused:false});
  expect(await run(['verify','--output',output])).toMatchObject({rows:count,httpRequests:0});
  await expect(run(args.map((value,index)=>index===4?String(count-1):value))).rejects.toThrow('row ceiling');
  expect(await run(['verify','--output',output])).toMatchObject({rows:count,httpRequests:0});
  expect(parseCsv(sample(),50001,raw.length)).toHaveLength(1);
  for(const bound of [0,NaN,Infinity,1.5])expect(()=>parseCsv(sample(),1,bound)).toThrow('byte');
 }finally{await rm(base,{recursive:true,force:true});}
},30000);
