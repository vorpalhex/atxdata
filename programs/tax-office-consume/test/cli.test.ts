import {test,expect} from 'bun:test';import {run} from '../src/cli';import {sample,pdf,temp} from './collector.test';import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';
test('CLI requires explicit selection and row limit before network and rejects extraneous arguments',async()=>{
 await expect(run(['collect','--output','unused'])).rejects.toThrow();await expect(run(['list','--unexpected'])).rejects.toThrow();expect(await run(['list'])).toEqual([{selection:'delinquency',csvBytes:4194304,layoutBytes:2097152,history:false}]);
});
test('CLI import/status/verify exercise actual private state and invalid selection does not create output',async()=>{
 const base=await temp(),root=join(base,'archive');await writeFile(join(base,'in.csv'),sample());await writeFile(join(base,'layout.pdf'),pdf);
 try{
  expect(await run(['import','--output',root,'--selection','delinquency','--max-rows','1','--csv',join(base,'in.csv'),'--layout',join(base,'layout.pdf')])).toMatchObject({rows:1,reused:false});
  expect(await run(['status','--output',root])).toMatchObject({complete:1});expect(await run(['verify','--output',root])).toMatchObject({rows:1,httpRequests:0});expect(await run(['collect','--output',root,'--selection','delinquency','--max-rows','1'])).toMatchObject({reused:true});
  await expect(run(['collect','--output',root,'--selection','all','--max-rows','1'])).rejects.toThrow('explicit');await expect(run(['collect','--output',root,'--selection','delinquency','--max-rows','0'])).rejects.toThrow();await expect(run(['verify','--output',root,'--output',root])).rejects.toThrow();await expect(run(['unknown'])).rejects.toThrow();
 }finally{await rm(base,{recursive:true,force:true});}
});
