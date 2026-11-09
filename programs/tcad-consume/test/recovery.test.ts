import {test,expect} from 'bun:test';import {readFile,mkdtemp,rm,rename} from 'node:fs/promises';import {join} from 'node:path';import {Store} from '../src/store';import {readSelection,SELECTION} from '../src/source';import {run} from '../src/cli';
const retained=process.env.TCAD_INPUTS?JSON.parse(await readFile(process.env.TCAD_INPUTS,'utf8')):null;
(retained?test:test.skip)('durable sample checkpoint recovers promotion interruption without manufacturing a version',async()=>{
 const base=await mkdtemp(join(process.env.TMPDIR!,'tcad-test-')),root=join(base,'archive');let store=await Store.open(root);
 try{
  const x=await readSelection(retained.archive,retained.layout,SELECTION,25),a=await store.checkpoint(x.raw);await rename(join(root,a.path),join(root,a.path)+'.pending');await store.close();store=await Store.open(root);expect(store.status().versions).toBe(0);await store.import(retained.archive,retained.layout,SELECTION,25);expect((await store.verify()).rows).toBe(25);
  store.db.query("UPDATE source_versions SET hash='changed' WHERE source='tcad-layout-legacy8.0.33'").run();await expect(store.verify()).rejects.toThrow('source/version');
 }finally{await store.close();await rm(base,{recursive:true,force:true});}
});
(retained?test:test.skip)('CLI import/status/verify/inventory use only retained originals',async()=>{
 const base=await mkdtemp(join(process.env.TMPDIR!,'tcad-test-')),root=join(base,'archive');try{
  expect(await run(['import','--archive',retained.archive,'--layout',retained.layout,'--selection',SELECTION,'--rows','25','--output',root])).toMatchObject({rows:25,reused:false});expect(await run(['status','--output',root])).toMatchObject({versions:1});expect(await run(['verify','--output',root])).toMatchObject({rows:25,httpRequests:0});expect(await run(['inventory','--archive',retained.archive,'--selection',SELECTION])).toMatchObject({httpRequests:0});
 }finally{await rm(base,{recursive:true,force:true});}
});
