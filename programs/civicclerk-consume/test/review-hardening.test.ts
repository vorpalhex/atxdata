import {test,expect} from 'bun:test';import {CivicDatabase} from '../src/storage/db';import {Database} from 'bun:sqlite';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {runCli} from '../src/cli';
test('snapshot exact stored JSON checksum is checked before offline normalization',async()=>{
 const root=await mkdtemp(join(tmpdir(),'civic-sha-')),path=join(root,'state.sqlite'),tenant='https://example.test/v1/';const db=new CivicDatabase(path,tenant);
 try{const event={id:1,eventName:'fixture',eventDate:'2030-03-04T00:00:00.000Z',publishedFiles:[]};db.snapshot(event);expect(db.cachedEvent(1)).toEqual(event);const fault=new Database(path);fault.query("UPDATE event_snapshots SET metadata=?").run(JSON.stringify({...event,eventName:'corrupt'}));fault.close();expect(()=>db.cachedEvent(1)).toThrow('checksum');}finally{db.close();await rm(root,{recursive:true,force:true});}
});
test('Civic rejects duplicate singleton flags before IO or client invocation',async()=>{
 let calls=0;const client={listEvents:async()=>{calls++;return [];},downloadEvent:async()=>{calls++;return {downloaded:0,skipped:0};}};
 await expect(runCli(['list-meetings','--from','2030-03-04','--to','2030-03-04','--max-pages=garbage','--max-pages=1'],client,()=>{})).rejects.toThrow('duplicate');expect(calls).toBe(0);
});
