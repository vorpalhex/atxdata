import {Database} from 'bun:sqlite';
import {join,resolve,dirname} from 'node:path';
import {open,readFile} from 'node:fs/promises';
import {archiveLock,statFile,promote} from '../../civicclerk-consume/src/archive';
import {input,sha256} from '../../financial-transparency-consume/src/files';
import {CAPS,ROUTES,parseCsv,validatePdf} from './source';
export type Deps={fetch:(url:string,init:RequestInit)=>Promise<Response>;now:()=>number;sleep:(ms:number)=>Promise<void>;random:()=>number};
type Artifact={id:string;snapshot:string;kind:'csv'|'layout';url:string;path:string;hash:string;bytes:number;status:string;run:string;headers:string|null;http_status:number|null};
type Snapshot={id:string;status:string;version:string|null;row_count:number|null;max_rows:number;mode:string;selection:string;source:string;observed_at:string;completion_run:string|null};
type Run={snapshot:string;command:string;limits:string;status:string;started_at:string;finished_at:string|null;error:string|null};
function verifyRunTimes(run:Run,observed:string,completion:boolean){
 const observation=Date.parse(observed),start=Date.parse(run.started_at);
 if(!Number.isFinite(observation)||!Number.isFinite(start)||start<observation)throw new Error('run provenance start');
 if(completion)verifyCompletion(run,start);
}
function verifyCompletion(run:Run,start:number){
 const finish=Date.parse(run.finished_at??'');
 if(run.status!=='succeeded'||run.error!==null||!Number.isFinite(finish)||finish<start)throw new Error('run provenance completion');
}
const SCHEMA=`PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL;PRAGMA journal_mode=DELETE;
 CREATE TABLE IF NOT EXISTS source(id TEXT PRIMARY KEY,url TEXT NOT NULL,label TEXT NOT NULL,schema_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES source(id),selection TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,version TEXT,row_count INTEGER,max_rows INTEGER NOT NULL,observed_at TEXT NOT NULL,publication_date TEXT);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL REFERENCES snapshots(id),command TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,error TEXT,limits TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL REFERENCES snapshots(id),run TEXT NOT NULL REFERENCES runs(id),kind TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,hash TEXT,bytes INTEGER NOT NULL,imported_at TEXT,retrieved_at TEXT,http_status INTEGER,headers TEXT,error TEXT);
 CREATE TABLE IF NOT EXISTS rows(snapshot TEXT NOT NULL REFERENCES snapshots(id),ordinal INTEGER NOT NULL,account TEXT NOT NULL,fields TEXT NOT NULL,first_year TEXT,PRIMARY KEY(snapshot,ordinal));
 CREATE TABLE IF NOT EXISTS cooldown(id INTEGER PRIMARY KEY CHECK(id=1),not_before REAL NOT NULL);INSERT OR IGNORE INTO cooldown VALUES(1,0);`;
export class Collector{
 readonly db:Database;readonly deps:Deps;private active=false;
 private constructor(readonly root:string,private release:()=>Promise<void>,deps:Partial<Deps>){
  this.deps={fetch:(url,init)=>Bun.fetch(url,{...init,decompress:false}),now:Date.now,sleep:Bun.sleep,random:Math.random,...deps};
  this.db=new Database(join(root,'state.sqlite'),{strict:true});this.db.exec(SCHEMA);
  this.migrateCompletion();
  const identity=JSON.stringify(this.db.query('SELECT * FROM source').all());
  if(identity!=='[]'&&identity!==JSON.stringify([{id:'tax-office/delinquency',url:ROUTES.discovery,label:'Travis County Tax Office delinquency',schema_id:'delinquency-31-v1'}])){this.db.close();throw new Error('source identity');}
  this.db.query('INSERT OR IGNORE INTO source VALUES(?,?,?,?)').run('tax-office/delinquency',ROUTES.discovery,'Travis County Tax Office delinquency','delinquency-31-v1');
  this.db.query("UPDATE runs SET status='interrupted',error='writer ended before checkpoint' WHERE status='running'").run();
  this.db.query("UPDATE artifacts SET status='interrupted' WHERE status='receiving'").run();
 }
 migrateCompletion(){
  const columns=this.db.query<{name:string},[]>('PRAGMA table_info(snapshots)').all();
  if(columns.some(c=>c.name==='completion_run'))return;
  this.db.exec("ALTER TABLE snapshots ADD COLUMN completion_run TEXT REFERENCES runs(id)");
  // Legacy evidence is bound only if the historical terminal run is unambiguous.
  this.db.exec("UPDATE snapshots SET completion_run=(SELECT id FROM runs WHERE snapshot=snapshots.id AND status='succeeded') WHERE status IN ('complete','reused') AND (SELECT count(*) FROM runs WHERE snapshot=snapshots.id AND status='succeeded')=1");
 }
 static async open(root:string,deps:Partial<Deps>={}){
  for(let p=resolve(root);p!==dirname(p);p=dirname(p)){if(await statFile(join(p,'.git')))throw new Error('runtime outside checkout required');}
  const release=await archiveLock(root);
  try{
   const info=await statFile(root);if(!info?.isDirectory()||(info.mode&0o077)||info.uid!==process.getuid!())throw new Error('private owned directory required');
   for(const f of ['state.sqlite','state.sqlite-journal','state.sqlite-wal','state.sqlite-shm'])await statFile(join(root,f));
   return new Collector(root,release,deps);
  }catch(e){await release();throw e;}
 }
 async close(){this.db.close();await this.release();}
 stamp(){return new Date(this.deps.now()).toISOString();}
 async exclusive<T>(work:()=>Promise<T>){if(this.active)throw new Error('one operation at a time');this.active=true;try{return await work();}finally{this.active=false;}}
 status(){return {complete:(this.db.query("SELECT count(*) n FROM snapshots WHERE status='complete'").get() as {n:number}).n,failed:(this.db.query("SELECT count(*) n FROM runs WHERE status IN ('failed','interrupted')").get() as {n:number}).n,cooldown:(this.db.query('SELECT not_before FROM cooldown').get() as {not_before:number}).not_before};}
 start(selection:string,maxRows:number,mode:string,refresh=false){
  if(selection!=='delinquency')throw new Error('only explicit delinquency selection supported');
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>CAPS.rows)throw new Error('row ceiling');
  if(refresh)this.db.query("UPDATE snapshots SET status='abandoned' WHERE mode=? AND max_rows=? AND status='collecting'").run(mode,maxRows);
  const prior=this.db.query<Snapshot,[string,number]>("SELECT * FROM snapshots WHERE mode=? AND max_rows=? AND status='collecting' ORDER BY rowid DESC LIMIT 1").get(mode,maxRows);
  const id=prior?.id??crypto.randomUUID(),run=crypto.randomUUID();
  if(!prior)this.db.query("INSERT INTO snapshots(id,source,selection,mode,status,version,row_count,max_rows,observed_at,publication_date) VALUES(?,?,?,?,'collecting',NULL,NULL,?,?,NULL)").run(id,'tax-office/delinquency',selection,mode,maxRows,this.stamp());
  this.db.query("INSERT INTO runs VALUES(?,?,?,'running',?,NULL,NULL,?)").run(run,id,mode,this.stamp(),JSON.stringify({...CAPS,maxRows}));return {id,run};
 }
 finish(run:string,status:string,error:unknown=null){this.db.query('UPDATE runs SET status=?,finished_at=?,error=? WHERE id=?').run(status,this.stamp(),error===null?null:String(error),run);}
 async retain(snapshot:string,run:string,kind:'csv'|'layout',raw:Buffer,metadata:{headers?:Headers;status?:number}={}){
  const hash=sha256(raw),existing=this.db.query<Artifact,[string,string]>("SELECT * FROM artifacts WHERE snapshot=? AND kind=? AND status='validated' ORDER BY rowid DESC LIMIT 1").get(snapshot,kind);
  if(existing){await this.bytes(existing);if(existing.hash!==hash)throw new Error('checkpoint source changed; use a new explicit refresh');return existing;}
  const id=crypto.randomUUID(),path=id+'.body';
  this.db.query("INSERT INTO artifacts(id,snapshot,run,kind,url,label,path,status,bytes) VALUES(?,?,?,?,?,?,?,'receiving',?)").run(id,snapshot,run,kind,ROUTES[kind],kind==='csv'?'Delinquent CSV':'Delinquency layout',path,raw.length);
  const h=await open(join(this.root,path)+'.pending','wx',0o600);try{await h.writeFile(raw);await h.sync();}finally{await h.close();}
  await promote(join(this.root,path));
  this.db.query("UPDATE artifacts SET status='validated',hash=?,imported_at=?,retrieved_at=?,http_status=?,headers=? WHERE id=?").run(hash,this.stamp(),metadata.status?this.stamp():null,metadata.status??null,metadata.headers?JSON.stringify(Object.fromEntries(metadata.headers)):null,id);
  return this.db.query<Artifact,[string]>('SELECT * FROM artifacts WHERE id=?').get(id)!;
 }
 async bytes(a:Artifact){
  if(!/^[0-9a-f-]{36}\.body$/.test(a.path)||a.url!==ROUTES[a.kind]||!['csv','layout'].includes(a.kind)||!Number.isSafeInteger(a.bytes)||a.bytes<1)throw new Error('artifact identity');
  const raw=input(join(this.root,a.path),CAPS[a.kind]);if(raw.length!==a.bytes||sha256(raw)!==a.hash)throw new Error('artifact hash');return raw;
 }
 async checkpoint(id:string,run:string,maxRows:number){
  const files=this.checkpointFiles(id);
  const raw=await this.bytes(files[0]!),layout=await this.bytes(files[1]!);const rows=parseCsv(raw,maxRows);validatePdf(layout);
  const version=sha256(Buffer.from(files.map(a=>a.hash).join(':')));
  const previous=this.db.query<Snapshot,[string,string]>("SELECT * FROM snapshots WHERE version=? AND status='complete' AND id<>?").get(version,id);
  this.db.transaction(()=>{
   this.db.query('DELETE FROM rows WHERE snapshot=?').run(id);
   for(const r of rows)this.db.query('INSERT INTO rows VALUES(?,?,?,?,?)').run(id,r.ordinal,r.fields[0]!,JSON.stringify(r.fields),r.firstDelinquentYear);
   this.db.query("UPDATE snapshots SET status=?,version=?,row_count=?,completion_run=? WHERE id=?").run(previous?'reused':'complete',version,rows.length,run,id);
   this.finish(run,'succeeded');
  }).immediate();return {snapshot:id,rows:rows.length,reused:!!previous,version};
 }
 async importRetained(selection:string,options:{csv:string;layout:string;maxRows:number;refresh?:boolean}){
  return this.exclusive(async()=>{
   const {id,run}=this.start(selection,options.maxRows,'retained',options.refresh);
   try{
    const raw=input(options.csv,CAPS.csv);parseCsv(raw,options.maxRows);await this.retain(id,run,'csv',raw);
    const layout=input(options.layout,CAPS.layout);validatePdf(layout);await this.retain(id,run,'layout',layout);
    await this.verify();
    return await this.checkpoint(id,run,options.maxRows);
   }catch(e){this.finish(run,'failed',e);throw e;}
  });
 }
 checkpointFiles(id:string){
  const files=this.db.query<Artifact,[string]>("SELECT * FROM artifacts WHERE snapshot=? AND status='validated' ORDER BY kind").all(id);
  if(files.length!==2||files[0]!.kind!=='csv'||files[1]!.kind!=='layout')throw new Error('two-artifact checkpoint required');return files;
 }
 verifyRows(id:string,rows:ReturnType<typeof parseCsv>){
  const stored=this.db.query('SELECT ordinal,account,fields,first_year FROM rows WHERE snapshot=? ORDER BY ordinal').all(id);
  if(JSON.stringify(stored)!==JSON.stringify(rows.map(r=>({ordinal:r.ordinal,account:r.fields[0],fields:JSON.stringify(r.fields),first_year:r.firstDelinquentYear}))))throw new Error('row provenance');
 }
 verifyRun(s:Snapshot,id:string,completion:boolean){
  const run=this.db.query<Run,[string]>('SELECT * FROM runs WHERE id=?').get(id);
  if(!run||run.snapshot!==s.id||run.command!==s.mode||run.limits!==JSON.stringify({...CAPS,maxRows:s.max_rows}))throw new Error('run provenance identity/mode/limits');
  verifyRunTimes(run,s.observed_at,completion);
 }
 verifyRuns(s:Snapshot,files:Artifact[]){
  this.verifyRun(s,s.completion_run??'',true);
  for(const f of files)this.verifyRun(s,f.run,false);
 }
 async verifyLive(s:Snapshot,files:Artifact[]){
  if(s.mode!=='live')return;
  for(const f of files){
   const attempt=this.db.query<{path:string;headers:string;http_status:number},[string,string,string,number]>("SELECT path,headers,http_status FROM attempts WHERE run=? AND kind=? AND url=? AND bytes=? AND status='validated' ORDER BY rowid DESC LIMIT 1").get(f.run,f.kind,f.url,f.bytes);
   if(!attempt||attempt.headers!==f.headers||attempt.http_status!==200||f.http_status!==200||!/^[-0-9a-f]{36}\.attempt$/.test(attempt.path))throw new Error('HTTP attempt provenance');
   if(sha256(input(join(this.root,attempt.path),CAPS[f.kind]))!==f.hash)throw new Error('HTTP body provenance');
  }
 }
 async verifySnapshot(s:Snapshot){
   if(s.source!=='tax-office/delinquency'||s.selection!=='delinquency'||!['retained','live'].includes(s.mode))throw new Error('selection identity');
   const files=this.checkpointFiles(s.id);
   const rows=parseCsv(await this.bytes(files[0]!),s.max_rows);validatePdf(await this.bytes(files[1]!));
   if(sha256(Buffer.from(files.map(a=>a.hash).join(':')))!==s.version||rows.length!==s.row_count)throw new Error('snapshot provenance');
   this.verifyRows(s.id,rows);this.verifyRuns(s,files);await this.verifyLive(s,files);
   if(s.status==='reused'&&!this.db.query("SELECT id FROM snapshots WHERE version=? AND status='complete' LIMIT 1").get(s.version))throw new Error('reuse history provenance');
   return rows.length;
 }
 async verify(){
  if((this.db.query('PRAGMA integrity_check').get() as {integrity_check:string}).integrity_check!=='ok'||this.db.query('PRAGMA foreign_key_check').all().length)throw new Error('SQLite integrity');
  const source=this.db.query('SELECT * FROM source').all();if(JSON.stringify(source)!==JSON.stringify([{id:'tax-office/delinquency',url:ROUTES.discovery,label:'Travis County Tax Office delinquency',schema_id:'delinquency-31-v1'}]))throw new Error('source identity');
  const snapshots=this.db.query<Snapshot,[]>('SELECT * FROM snapshots WHERE status IN (\'complete\',\'reused\')').all();let count=0;
  for(const s of snapshots){const n=await this.verifySnapshot(s);if(s.status==='complete')count+=n;}
  return {snapshots:snapshots.filter(s=>s.status==='complete').length,rows:count,httpRequests:0};
 }
}
