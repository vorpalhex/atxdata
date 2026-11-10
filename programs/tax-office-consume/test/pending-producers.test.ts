import {test,expect} from 'bun:test';import {Collector} from '../src/collector';import {collectExport} from '../src/export-live';import {retainCatalog,exportLimits,importExport,verifyPartialExport} from '../src/exports';import {ROUTES} from '../src/source';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Database} from 'bun:sqlite';
const selection='/voterdata/fresh.csv',limits=exportLimits({maxBytes:10000,maxRows:100,maxRequests:8,maxTotalBytes:16000000});
const page='<a href="/voterdata/fresh.csv">Fresh CSV</a>',paired=page+'<a href="/pages/CurrentFileLayout.php">Tax Current Year and Prior Year Delinquent File Layout</a>';
async function failedCheckpoint(withFile=false,cached=false){
 const root=await mkdtemp(join(tmpdir(),'pending-producer-')),archive=join(root,'archive');let now=100000;
 // The paired fixture uses the published current-roll label to bind its layout.
 const html=withFile?paired.replace('Fresh CSV','Tax Current Year and Prior Year Delinquent CSV'):page;
 await writeFile(join(root,'page'),html);await writeFile(join(root,'raw'),'original');
 const c=await Collector.open(archive,{now:()=>now,sleep:async n=>{now+=n;},random:()=>0,fetch:async url=>url===ROUTES.robots?new Response('',{status:404}):url===ROUTES.discovery?new Response(html):withFile&&!url.includes('/pages/')?new Response('original'):new Response('authored 503',{status:503})});
 try{await retainCatalog(c,join(root,'page'));await expect(collectExport(c,selection,{limits})).rejects.toThrow('503');
  const snapshot=c.db.query<{id:string},[]>("SELECT id FROM snapshots WHERE status='collecting'").get()!.id;
  const files=c.db.query<{n:number},[]>('SELECT count(*) n FROM artifacts').get()!.n;expect(files).toBe(withFile?1:0);
  let run=c.db.query<{id:string},[string]>('SELECT id FROM runs WHERE snapshot=?').get(snapshot)!.id;
  if(withFile){run=crypto.randomUUID();c.db.query("INSERT INTO runs VALUES(?,?,?,'failed',?,?,?,?)").run(run,snapshot,'raw-live',c.stamp(),c.stamp(),'stopped before another artifact',JSON.stringify(limits));}
  if(cached)await importExport(c,selection,{file:join(root,'raw'),limits});
  return {root,archive,snapshot,run,html};
 }finally{await c.close();}
}
function state(db:Database){return {attempts:db.query('SELECT * FROM attempts ORDER BY rowid').all(),runs:db.query('SELECT * FROM runs ORDER BY rowid').all(),snapshots:db.query('SELECT * FROM snapshots ORDER BY rowid').all(),cooldown:db.query('SELECT * FROM cooldown').all()};}
async function nativeCase(options:{refresh?:boolean;abandoned?:boolean;raised?:boolean;withFile?:boolean;cached?:boolean;valid?:'failed'|'interrupted'}={}){
 const seed=await failedCheckpoint(options.withFile,options.cached);let calls=0;const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){calls++;const path=new URL(req.url).pathname;return path==='/robots.txt'?new Response('',{status:404}):new Response(path==='/pages/property.php'?seed.html:'original');}});
 try{let db=new Database(join(seed.archive,'state.sqlite'));if(!options.valid)db.query("UPDATE runs SET command='unrelated' WHERE id=?").run(seed.run);else if(options.valid==='interrupted')db.query("UPDATE runs SET status='interrupted',finished_at=NULL,error='writer ended after reservation' WHERE id=?").run(seed.run);
  if(options.abandoned)db.query("UPDATE snapshots SET status='abandoned' WHERE id=?").run(seed.snapshot);const before=state(db);db.close();
  const command=[process.execPath,'--preload',join(import.meta.dir,'native-producer-preload.ts'),'src/cli.ts','collect','--selection',selection,'--output',seed.archive,'--max-bytes','10000','--max-rows','100','--max-requests',options.raised?'9':'8','--max-total-bytes','16000000',...(options.refresh?['--refresh']:[])];
  const child=Bun.spawn(command,{cwd:join(import.meta.dir,'..'),env:{...process.env,PRODUCER_FIXTURE_URL:server.url.href},stdout:'pipe',stderr:'pipe'});const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);db=new Database(join(seed.archive,'state.sqlite'),{readonly:true});const after=state(db);db.close();
  if(options.valid){expect({exit,stderr}).toEqual({exit:0,stderr:''});expect(JSON.parse(stdout)).toMatchObject({rows:null,profile:'raw-original'});expect(calls).toBe(3);expect(after.attempts.slice(0,before.attempts.length)).toEqual(before.attempts);expect(after.runs.slice(0,before.runs.length)).toEqual(before.runs);}
  else{expect(exit).toBe(1);expect(stderr).toContain('run provenance');expect(stdout).toBe('');expect(calls).toBe(0);expect(after).toEqual(before);}
 }finally{server.stop(true);await rm(seed.root,{recursive:true,force:true});}
}
for(const abandoned of [false,true])for(const raised of [false,true])for(const refresh of [false,true])test(`native bound zero-artifact producer preflight abandoned=${abandoned} raised=${raised} refresh=${refresh}`,()=>nativeCase({abandoned,raised,refresh}));
test('native bound partial validates a producer not referenced by its valid file',()=>nativeCase({withFile:true}));
test('native cache reuse cannot hide a corrupt bound empty pending producer',()=>nativeCase({cached:true}));
for(const valid of ['failed','interrupted'] as const)test('native genuine '+valid+' producer remains resumable',()=>nativeCase({valid}));
test('bound pending checkpoint requires at least one retained run without dropping reservations',async()=>{
 const seed=await failedCheckpoint();const c=await Collector.open(seed.archive,{fetch:async()=>{throw Error('unexpected HTTP');}});
 try{const attempts=c.db.query('SELECT * FROM attempts').all();c.db.exec('PRAGMA foreign_keys=OFF');c.db.query('DELETE FROM runs WHERE snapshot=?').run(seed.snapshot);await expect(verifyPartialExport(c,seed.snapshot)).rejects.toThrow('partial run missing');expect(c.db.query('SELECT * FROM attempts').all()).toEqual(attempts);}finally{await c.close();await rm(seed.root,{recursive:true,force:true});}
});
for(const [field,value] of [['command','unrelated'],['limits','{}'],['started_at','bad'],['finished_at',null],['status','unknown'],['error',null]] as const)test('bound empty library producer rejects '+field,async()=>{
 const seed=await failedCheckpoint();const c=await Collector.open(seed.archive,{fetch:async()=>{throw Error('unexpected HTTP');}});
 try{c.db.query(`UPDATE runs SET ${field}=? WHERE id=?`).run(value,seed.run);await expect(verifyPartialExport(c,seed.snapshot)).rejects.toThrow();}finally{await c.close();await rm(seed.root,{recursive:true,force:true});}
});
