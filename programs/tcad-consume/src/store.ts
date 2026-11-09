import {Database} from 'bun:sqlite';import {join,dirname,resolve} from 'node:path';import {open} from 'node:fs/promises';import {archiveLock,statFile,promote} from '../../civicclerk-consume/src/archive';import {archivePath} from '../../financial-transparency-consume/src/archive';import {input,sha256} from '../../financial-transparency-consume/src/files';import {ARCHIVE_HASH,LAYOUT_HASH,URLS,SELECTION,selected,readSelection} from './source';
import {initializeLive,preflightLive} from './live';
import {initializeMembers,importMember,verifyMembers,type MemberOptions} from './members';
type Selection=Awaited<ReturnType<typeof readSelection>>;
type Version={id:string;selection:string;archive_hash:string;layout_hash:string;archive_path:string;layout_path:string;sample_path:string;sample_hash:string;fields:string;members:string;header:Uint8Array;coverage:string;row_count:number;rejected:number;download:string};
const SOURCES=[{id:'tcad-certified-2026-supp0',url:URLS.archive,label:'2026 Certified Appraisal Export (July)'},{id:'tcad-layout-legacy8.0.33',url:URLS.layout,label:'Export Layouts'}];
const SCHEMA=`PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL;PRAGMA journal_mode=DELETE;
 CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,url TEXT NOT NULL,label TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS downloads(id TEXT PRIMARY KEY,path TEXT NOT NULL,status TEXT NOT NULL,hash TEXT,bytes INTEGER,created_at TEXT NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,selection TEXT NOT NULL,archive_hash TEXT NOT NULL,layout_hash TEXT NOT NULL,archive_path TEXT NOT NULL,layout_path TEXT NOT NULL,sample_path TEXT NOT NULL,sample_hash TEXT NOT NULL,fields TEXT NOT NULL,members TEXT NOT NULL,header BLOB NOT NULL,coverage TEXT NOT NULL,row_count INTEGER NOT NULL,rejected INTEGER NOT NULL,download TEXT NOT NULL REFERENCES downloads(id),observed_at TEXT NOT NULL,retrieved_at TEXT,publication_date TEXT);
 CREATE TABLE IF NOT EXISTS property_rows(version TEXT NOT NULL REFERENCES versions(id),member TEXT NOT NULL,ordinal INTEGER NOT NULL,property TEXT NOT NULL,year TEXT NOT NULL,supplement TEXT NOT NULL,owner TEXT NOT NULL,fields TEXT NOT NULL,reason TEXT,PRIMARY KEY(version,member,ordinal));
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,version TEXT REFERENCES versions(id),status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,error TEXT,selection TEXT NOT NULL,limits TEXT NOT NULL,http_requests INTEGER NOT NULL CHECK(http_requests=0));
 CREATE TABLE IF NOT EXISTS source_versions(version TEXT NOT NULL REFERENCES versions(id),source TEXT NOT NULL REFERENCES sources(id),hash TEXT NOT NULL,PRIMARY KEY(version,source));
 CREATE TABLE IF NOT EXISTS cooldown(source TEXT PRIMARY KEY REFERENCES sources(id),not_before INTEGER NOT NULL CHECK(not_before=0));`;
export class Store{
 readonly db:Database;private active=false;
 private constructor(readonly root:string,private release:()=>Promise<void>){
  this.db=new Database(join(root,'state.sqlite'),{strict:true});try{preflightLive(this.db);}catch(e){this.db.close();throw e;}this.db.exec(SCHEMA);initializeMembers(this.db);initializeLive(this.db);this.db.query("UPDATE member_versions SET status='interrupted',error='writer ended before completion' WHERE status='importing'").run();
  const existing=this.db.query('SELECT * FROM sources ORDER BY id').all();if(existing.length&&JSON.stringify(existing)!==JSON.stringify(SOURCES)){this.db.close();throw new Error('TCAD source identity');}
  for(const s of SOURCES){this.db.query('INSERT OR IGNORE INTO sources VALUES(?,?,?)').run(s.id,s.url,s.label);this.db.query('INSERT OR IGNORE INTO cooldown VALUES(?,0)').run(s.id);}
  this.db.query("UPDATE runs SET status='interrupted',error='writer ended before checkpoint' WHERE status='running'").run();
 }
 static async open(root:string){
  for(let p=resolve(root);p!==dirname(p);p=dirname(p))if(await statFile(join(p,'.git')))throw new Error('runtime outside checkout required');
  const release=await archiveLock(root);try{archivePath(root);for(const n of ['state.sqlite','state.sqlite-journal','state.sqlite-wal','state.sqlite-shm'])await statFile(join(root,n));return new Store(root,release);}catch(e){await release();throw e;}
 }
 async importMember(options:MemberOptions){if(this.active)throw new Error('one operation at a time');this.active=true;try{return await importMember(this.db,options);}finally{this.active=false;}}
 async verifyMembers(){return verifyMembers(this.db);}
 async close(){this.db.close();await this.release();}
 status(){return {versions:(this.db.query('SELECT count(*) n FROM versions').get() as {n:number}).n,rows:(this.db.query('SELECT count(*) n FROM property_rows').get() as {n:number}).n,failed:(this.db.query("SELECT count(*) n FROM runs WHERE status IN ('failed','interrupted')").get() as {n:number}).n,httpRequests:0};}
 async import(archive:string,layout:string,selection:string,rows:number){
  preflightLive(this.db);selected(selection,rows);if(this.active)throw new Error('one operation at a time');this.active=true;
  const run=crypto.randomUUID();this.db.query("INSERT INTO runs VALUES(?,NULL,'running',?,NULL,NULL,?,?,0)").run(run,new Date().toISOString(),selection,JSON.stringify({rows:25,compressed:671088640,total:21474836480,member:10737418240}));
  try{
   const x=await readSelection(archive,layout,selection,rows),id=sha256(Buffer.from(ARCHIVE_HASH+':'+LAYOUT_HASH+':'+SELECTION));
   const prior=this.db.query<Version,[string]>('SELECT * FROM versions WHERE id=?').get(id);
   if(prior){await this.verify();this.finish(run,'reused',id);return {version:id,rows:25,rejected:prior.rejected,reused:true,coverage:prior.coverage};}
   const artifact=await this.checkpoint(x.raw);this.save(id,archive,layout,x,artifact,run);
   return {version:id,rows:25,rejected:x.rows.filter(r=>r.reason!==null).length,reused:false,coverage:x.coverage};
  }catch(e){this.finish(run,'failed',null,e);throw e;}finally{this.active=false;}
 }
 finish(run:string,status:string,version:string|null,error:unknown=null){preflightLive(this.db);this.db.query('UPDATE runs SET status=?,version=?,finished_at=?,error=? WHERE id=?').run(status,version,new Date().toISOString(),error===null?null:String(error),run);}
 async checkpoint(raw:Buffer){
  preflightLive(this.db);
  const hash=sha256(raw),prior=this.db.query<{id:string;path:string},[string]>("SELECT id,path FROM downloads WHERE hash=? AND status='checkpointed' ORDER BY rowid DESC LIMIT 1").get(hash);
  if(prior){
   this.filename(prior.path);const final=await statFile(join(this.root,prior.path)),pending=await statFile(join(this.root,prior.path)+'.pending');if(!!final===!!pending)throw new Error('checkpoint requires exactly one artifact; operator recovery');
   const path=join(this.root,prior.path)+(final?'':'.pending');if(sha256(input(path,248100))!==hash)throw new Error('checkpoint hash');if(pending)await promote(join(this.root,prior.path));return {...prior,hash};
  }
  const id=crypto.randomUUID(),path=id+'.property';this.db.query("INSERT INTO downloads VALUES(?,?,'staging',?,?,?,NULL)").run(id,path,hash,raw.length,new Date().toISOString());
  const handle=await open(join(this.root,path)+'.pending','wx',0o600);try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  this.db.query("UPDATE downloads SET status='checkpointed' WHERE id=?").run(id);await promote(join(this.root,path));return {id,path,hash};
 }
 filename(path:string){if(!/^[0-9a-f-]{36}\.property$/.test(path))throw new Error('unsafe sample path');}
 save(id:string,archive:string,layout:string,x:Selection,a:{id:string;path:string;hash:string},run:string){
  this.db.transaction(()=>{
   this.db.query('INSERT INTO versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(id,SELECTION,ARCHIVE_HASH,LAYOUT_HASH,archive,layout,a.path,a.hash,JSON.stringify(x.fields),JSON.stringify(x.members),x.header,x.coverage,25,x.rows.filter(r=>r.reason!==null).length,a.id,new Date().toISOString());
   for(const r of x.rows)this.db.query('INSERT INTO property_rows VALUES(?,?,?,?,?,?,?,?,?)').run(id,'PROP.TXT',r.ordinal,r.keys.property,r.keys.year,r.keys.supplement,r.keys.owner,JSON.stringify(r.values),r.reason);
   this.db.query('INSERT INTO source_versions VALUES(?,?,?)').run(id,SOURCES[0]!.id,ARCHIVE_HASH);this.db.query('INSERT INTO source_versions VALUES(?,?,?)').run(id,SOURCES[1]!.id,LAYOUT_HASH);
   this.db.query("UPDATE downloads SET status='complete' WHERE id=?").run(a.id);this.finish(run,'succeeded',id);
  }).immediate();
 }
 verifyRuns(v:Version){
  const runs=this.db.query<{selection:string;http_requests:number;limits:string},[string]>("SELECT selection,http_requests,limits FROM runs WHERE version=? AND status IN ('succeeded','reused')").all(v.id);
  if(!runs.length||runs.some(r=>r.selection!==SELECTION||r.http_requests!==0||JSON.parse(r.limits).rows!==25))throw new Error('run provenance');
 }
 verifyRows(v:Version,x:Selection){
  const projected=x.rows.map(r=>({member:'PROP.TXT',ordinal:r.ordinal,property:r.keys.property,year:r.keys.year,supplement:r.keys.supplement,owner:r.keys.owner,fields:JSON.stringify(r.values),reason:r.reason}));
  if(JSON.stringify(this.db.query('SELECT member,ordinal,property,year,supplement,owner,fields,reason FROM property_rows WHERE version=? ORDER BY ordinal').all(v.id))!==JSON.stringify(projected)||v.rejected!==x.rows.filter(r=>r.reason!==null).length)throw new Error('row provenance');
 }
 verifyLinks(v:Version){
  const links=this.db.query('SELECT source,hash FROM source_versions WHERE version=? ORDER BY source').all(v.id);if(JSON.stringify(links)!==JSON.stringify([{source:SOURCES[0]!.id,hash:ARCHIVE_HASH},{source:SOURCES[1]!.id,hash:LAYOUT_HASH}]))throw new Error('source/version provenance');
 }
 verifyDownload(v:Version){
  const d=this.db.query<{path:string;hash:string;bytes:number;status:string},[string]>('SELECT path,hash,bytes,status FROM downloads WHERE id=?').get(v.download);if(d?.path!==v.sample_path||d.hash!==v.sample_hash||d.bytes!==248100||d.status!=='complete')throw new Error('download provenance'); }
 versionIdentity(v:Version){
  if(v.id!==sha256(Buffer.from(ARCHIVE_HASH+':'+LAYOUT_HASH+':'+SELECTION))||v.selection!==SELECTION||v.archive_hash!==ARCHIVE_HASH||v.layout_hash!==LAYOUT_HASH||v.row_count!==25)throw new Error('version identity');this.filename(v.sample_path);
 }
 async verifyVersion(v:Version){
  this.versionIdentity(v);
  const x=await readSelection(v.archive_path,v.layout_path,v.selection,25),raw=input(join(this.root,v.sample_path),248100);
  if(!raw.equals(x.raw)||sha256(raw)!==v.sample_hash||JSON.stringify(x.fields)!==v.fields||JSON.stringify(x.members)!==v.members||!Buffer.from(v.header).equals(x.header)||x.coverage!==v.coverage)throw new Error('version provenance');
  this.verifyRows(v,x);this.verifyLinks(v);this.verifyDownload(v);this.verifyRuns(v);

 }
 async verify(){
  preflightLive(this.db);
  if((this.db.query('PRAGMA integrity_check').get() as {integrity_check:string}).integrity_check!=='ok'||this.db.query('PRAGMA foreign_key_check').all().length)throw new Error('SQLite integrity');
  if(JSON.stringify(this.db.query('SELECT * FROM sources ORDER BY id').all())!==JSON.stringify(SOURCES))throw new Error('source identity');
  const versions=this.db.query<Version,[]>('SELECT * FROM versions').all();for(const v of versions)await this.verifyVersion(v);return {versions:versions.length,rows:versions.length*25,httpRequests:0};
 }
}
