import {test,expect} from 'bun:test';import {Store} from '../src/store';import {SELECTION} from '../src/source';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';
const retained=process.env.TCAD_INPUTS?JSON.parse(await readFile(process.env.TCAD_INPUTS,'utf8')):null;
(retained?test:test.skip)('SQLite import reuses originals without HTTP and binds rows/member/selection/hash provenance',async()=>{
 const base=await mkdtemp(join(process.env.TMPDIR!,'tcad-test-')),root=join(base,'archive');const store=await Store.open(root);const originalFetch=globalThis.fetch;globalThis.fetch=Object.assign(()=>{throw new Error('network forbidden');},{preconnect:originalFetch.preconnect});
 try{
  const a=await store.import(retained.archive,retained.layout,SELECTION,25);expect(a).toMatchObject({rows:25,rejected:0,reused:false});
  const b=await store.import(retained.archive,retained.layout,SELECTION,25);expect(b.reused).toBe(true);expect(store.status()).toMatchObject({versions:1,rows:25});expect(await store.verify()).toMatchObject({versions:1,rows:25,httpRequests:0});
  await expect(Store.open(root)).rejects.toThrow();store.db.query("UPDATE property_rows SET year='2026'").run();await expect(store.verify()).rejects.toThrow('row provenance');
 }finally{globalThis.fetch=originalFetch;await store.close();await rm(base,{recursive:true,force:true});}
});
test('unsupported selection is rejected before archive IO and failed imports persist',async()=>{
 const base=await mkdtemp(join(process.env.TMPDIR!,'tcad-test-')),store=await Store.open(join(base,'archive'));
 try{await expect(store.import('missing','missing','all',25)).rejects.toThrow('selection');await expect(store.import('missing','missing',SELECTION,25)).rejects.toThrow();expect(store.status()).toMatchObject({versions:0,failed:1});}finally{await store.close();await rm(base,{recursive:true,force:true});}
});
