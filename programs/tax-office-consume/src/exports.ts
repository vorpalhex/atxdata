import {join} from 'node:path';
import {producerBounds,observedWithin,attemptTimes,artifactTimes} from './provenance';
import {Collector,verifyRunTimes} from './collector';
import {input,sha256} from '../../financial-transparency-consume/src/files';
import {promote} from '../../civicclerk-consume/src/archive';
import {fileDigest} from './files';
import {parseCatalog,type Item} from './catalog';
import {CAPS,ROUTES,positive} from './source';
export const EXPORT_SOURCE={id:'tax-office/exports',url:ROUTES.discovery,label:'Travis County Tax Office published exports',schema_id:'raw-original-v1'};
export type ExportLimits={maxBytes:number;maxRows:number;maxRequests:number;maxTotalBytes:number};
export function exportLimits(options:Partial<ExportLimits>={}):ExportLimits{
 const limits={maxBytes:512*1024**2,maxRows:1000000,maxRequests:12,maxTotalBytes:1024*1024**2,...options};
 for(const [name,value] of Object.entries(limits))positive(value,name);return limits;
}
export function exportSetup(c:Collector){
 c.db.exec(`CREATE TABLE IF NOT EXISTS catalogs(id TEXT PRIMARY KEY,path TEXT NOT NULL,items TEXT NOT NULL,observed_at TEXT NOT NULL,run TEXT REFERENCES runs(id));
 CREATE TABLE IF NOT EXISTS export_bindings(snapshot TEXT PRIMARY KEY REFERENCES snapshots(id),catalog TEXT NOT NULL REFERENCES catalogs(id),item TEXT NOT NULL,profile TEXT NOT NULL,limits TEXT NOT NULL);`);
 if(!c.db.query<{name:string},[]>('PRAGMA table_info(catalogs)').all().some(x=>x.name==='provenance')){c.db.exec("ALTER TABLE catalogs ADD COLUMN provenance TEXT NOT NULL DEFAULT 'retained'; UPDATE catalogs SET provenance='http' WHERE run IS NOT NULL");}
 c.db.query('INSERT OR IGNORE INTO source VALUES(?,?,?,?)').run(EXPORT_SOURCE.id,EXPORT_SOURCE.url,EXPORT_SOURCE.label,EXPORT_SOURCE.schema_id);
}
type Catalog={id:string;path:string;items:string;observed_at:string;run:string|null;provenance:string};
export async function retainCatalog(c:Collector,file:string,run:string|null=null){
 exportSetup(c);const raw=input(file,CAPS.discovery),id=sha256(raw),items=parseCatalog(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 const prior=c.db.query<Catalog,[string]>('SELECT * FROM catalogs WHERE id=?').get(id);
 if(prior){await readCatalog(c,id);return {version:id,items};}
 const path=crypto.randomUUID()+'.catalog',copied=await fileDigest(file,CAPS.discovery,join(c.root,path)+'.pending');if(copied.hash!==id)throw new Error('catalog input_changed');await promote(join(c.root,path));
 c.db.query('INSERT INTO catalogs(id,path,items,observed_at,run,provenance) VALUES(?,?,?,?,?,?)').run(id,path,JSON.stringify(items),c.stamp(),run,run===null?'retained':'http');return {version:id,items};
}
export async function readCatalog(c:Collector,version?:string){
 exportSetup(c);
 const catalog=version?c.db.query<Catalog,[string]>('SELECT * FROM catalogs WHERE id=?').get(version):c.db.query<Catalog,[]>('SELECT * FROM catalogs ORDER BY rowid DESC LIMIT 1').get();
 if(!catalog||!/^[-0-9a-f]{36}\.catalog$/.test(catalog.path))throw new Error('retained catalog version required; run discover or catalog-import');
 const raw=input(join(c.root,catalog.path),CAPS.discovery),items=parseCatalog(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(sha256(raw)!==catalog.id||JSON.stringify(items)!==catalog.items||!Number.isFinite(Date.parse(catalog.observed_at)))throw new Error('catalog provenance');
 await verifyCatalogOrigin(c,catalog);
 return {version:catalog.id,items};
}
async function verifyCatalogOrigin(c:Collector,catalog:Catalog){
 if(catalog.provenance==='http'&&catalog.run!==null)await verifyCatalogHTTP(c,catalog);
 else if(catalog.provenance!=='retained'||catalog.run!==null||Date.parse(catalog.observed_at)>c.deps.now())throw new Error('catalog origin provenance');
}
function catalogRunLimits(encoded:string,snapshot:ExportSnapshot){
 const limits=exportLimits(JSON.parse(encoded));if(JSON.stringify(limits)!==encoded||limits.maxRows!==snapshot.max_rows||limits.maxBytes!==snapshot.max_bytes)throw new Error('catalog run limits');
}
function catalogProducer(c:Collector,catalog:Catalog){
 const run=c.db.query<{snapshot:string;command:string;limits:string;started_at:string;finished_at:string|null;status:string;error:string|null},[string]>('SELECT * FROM runs WHERE id=?').get(catalog.run!);
 const snapshot=run?c.db.query<ExportSnapshot,[string]>('SELECT * FROM snapshots WHERE id=?').get(run.snapshot):null;
 if(!run||!snapshot||snapshot.source!==EXPORT_SOURCE.id||!['discovery','raw-live'].includes(snapshot.mode)||run.command!==snapshot.mode)throw new Error('catalog run provenance');
 catalogRunLimits(run.limits,snapshot);
 verifyRunTimes(run,snapshot.observed_at,false);observedWithin(catalog.observed_at,producerBounds(run,c.deps.now()));return run;
}
async function verifyCatalogHTTP(c:Collector,catalog:Catalog){
 const run=catalogProducer(c,catalog);
 const attempt=c.db.query<{path:string;started_at:string;finished_at:string|null;status:string;error:string|null},[string,string]>("SELECT * FROM attempts WHERE run=? AND kind='discovery' AND url=? AND status='validated' AND http_status=200 ORDER BY rowid DESC LIMIT 1").get(catalog.run!,ROUTES.discovery);
 if(!attempt||!/^[-0-9a-f]{36}\.attempt$/.test(attempt.path)||(await fileDigest(join(c.root,attempt.path),CAPS.discovery)).hash!==catalog.id)throw new Error('catalog HTTP provenance');
 if(attemptTimes(attempt,run,c.deps.now())>Date.parse(catalog.observed_at))throw new Error('catalog attempt observation chronology');
}
export async function selectedItem(c:Collector,selection:string,catalogVersion?:string){
 const catalog=await readCatalog(c,catalogVersion),item=catalog.items.find(i=>i.id===selection);if(!item)throw new Error('selection not in retained published catalog');return {catalog:catalog.version,item};
}
export function startExport(c:Collector,selection:string,mode:string,limits:ExportLimits,refresh=false){
 exportSetup(c);const id=crypto.randomUUID(),run=crypto.randomUUID();
 // Discovery observations are not completed data snapshots.
 c.db.query("INSERT INTO snapshots(id,source,selection,mode,status,max_rows,max_bytes,observed_at) VALUES(?,?,?,?,?,?,?,?)").run(id,EXPORT_SOURCE.id,selection,mode,'collecting',limits.maxRows,limits.maxBytes,c.stamp());
 c.db.query("INSERT INTO runs VALUES(?,?,?,'running',?,NULL,NULL,?)").run(run,id,mode,c.stamp(),JSON.stringify(limits));return {id,run};
}
export function bindExport(c:Collector,id:string,catalog:string,item:Item,limits:ExportLimits){c.db.query('INSERT INTO export_bindings VALUES(?,?,?,?,?)').run(id,catalog,JSON.stringify(item),'raw-original',JSON.stringify(limits));}
type RawArtifact={id:string;snapshot:string;run:string;kind:string;url:string;path:string;hash:string;bytes:number;headers:string|null;http_status:number|null;imported_at:string|null;retrieved_at:string|null;error:string|null};
export async function retainExportFile(c:Collector,id:string,run:string,kind:'data'|'layout',file:string,url:string,limits:ExportLimits,metadata?:{headers:Headers;status:number}){
 const digest=await fileDigest(file,limits.maxBytes),existing=c.db.query<RawArtifact,[string,string]>("SELECT * FROM artifacts WHERE snapshot=? AND kind=? AND status='validated'").get(id,kind);
 if(existing){if(existing.url!==url||existing.hash!==digest.hash)throw new Error('export checkpoint source changed; explicit refresh required');await verifyExportFile(c,existing,limits.maxBytes,url);return;}
 const artifact=crypto.randomUUID(),path=artifact+'.body';c.db.query("INSERT INTO artifacts(id,snapshot,run,kind,url,label,path,status,bytes) VALUES(?,?,?,?,?,?,?,'receiving',?)").run(artifact,id,run,kind,url,'Raw original; semantic format unsupported',path,digest.bytes);
 const copy=await fileDigest(file,limits.maxBytes,join(c.root,path)+'.pending');if(copy.hash!==digest.hash)throw new Error('input_changed');await promote(join(c.root,path));
 c.db.query("UPDATE artifacts SET status='validated',hash=?,imported_at=?,retrieved_at=?,http_status=?,headers=? WHERE id=?").run(copy.hash,c.stamp(),metadata?c.stamp():null,metadata?.status??null,metadata?JSON.stringify(Object.fromEntries(metadata.headers)):null,artifact);
}
async function verifyExportFile(c:Collector,file:RawArtifact,maxBytes:number,url:string){
 if(!/^[-0-9a-f]{36}\.body$/.test(file.path)||file.url!==url)throw new Error('export artifact identity');const actual=await fileDigest(join(c.root,file.path),maxBytes);if(actual.hash!==file.hash||actual.bytes!==file.bytes)throw new Error('export artifact hash');
}
export function exportVersion(item:Item,files:RawArtifact[]){return sha256(Buffer.from(JSON.stringify([item,files.map(f=>[f.kind,f.url,f.hash])])));}
function exportFiles(c:Collector,id:string,item:Item){
 const files=c.db.query<RawArtifact,[string]>("SELECT * FROM artifacts WHERE snapshot=? AND status='validated' ORDER BY kind").all(id);
 if(files.length!==(item.layout?2:1)||files[0]?.kind!=='data'||(item.layout&&files[1]?.kind!=='layout'))throw new Error('complete export artifact set required');
 return files;
}
export async function finishExport(c:Collector,id:string,run:string,item:Item,limits:ExportLimits){
 const files=exportFiles(c,id,item);
 for(const f of files)await verifyExportFile(c,f,limits.maxBytes,f.kind==='data'?item.url:item.layout!);
 const version=exportVersion(item,files),prior=c.db.query('SELECT id FROM snapshots WHERE source=? AND selection=? AND version=? AND status=\'complete\' AND id<>?').get(EXPORT_SOURCE.id,item.id,version,id);
 c.db.transaction(()=>{c.db.query('UPDATE snapshots SET status=?,version=?,row_count=NULL,completion_run=? WHERE id=?').run(prior?'reused':'complete',version,run,id);c.finish(run,'succeeded');}).immediate();
 return {snapshot:id,version,selection:item.id,rows:null,profile:'raw-original',unsupportedFormat:item.format,reused:!!prior};
}
export async function importExport(c:Collector,selection:string,options:{file:string;layout?:string;catalogVersion?:string;limits?:Partial<ExportLimits>}){
 return c.exclusive(async()=>{
  const limits=exportLimits(options.limits),{catalog,item}=await selectedItem(c,selection,options.catalogVersion);
  if(item.layout&&!options.layout)throw new Error('selected dataset layout required');if(!item.layout&&options.layout)throw new Error('selected dataset has no paired layout');
  const {id,run}=startExport(c,selection,'raw-retained',limits);bindExport(c,id,catalog,item,limits);
  try{await retainExportFile(c,id,run,'data',options.file,item.url,limits);if(item.layout)await retainExportFile(c,id,run,'layout',options.layout!,item.layout,limits);return await finishExport(c,id,run,item,limits);}catch(error){c.finish(run,'failed',error);throw error;}
 });
}
type ExportSnapshot={id:string;source:string;selection:string;mode:string;version:string|null;row_count:number|null;max_rows:number;max_bytes:number;observed_at:string;completion_run:string|null;status:string};
export function verifyUnboundExport(c:Collector,id:string){
 const s=c.db.query<ExportSnapshot,[string]>('SELECT * FROM snapshots WHERE id=?').get(id)!;
 if(s.source!==EXPORT_SOURCE.id||!['raw-live','raw-retained'].includes(s.mode))throw new Error('unbound export identity');
 if(c.db.query('SELECT id FROM artifacts WHERE snapshot=?').get(id))throw new Error('unbound export checkpoint artifacts');
 const runs=c.db.query<{id:string;limits:string},[string]>('SELECT id,limits FROM runs WHERE snapshot=?').all(id);if(!runs.length)throw new Error('unbound export run missing');
 for(const run of runs){catalogRunLimits(run.limits,s);verifyExportRun(c,s,run.id,run.limits,false);}
}
function verifyPendingRuns(c:Collector,s:ExportSnapshot,limits:string){
 const runs=c.db.query<{id:string},[string]>('SELECT id FROM runs WHERE snapshot=?').all(s.id);
 if(!runs.length)throw new Error('partial run missing');
 for(const run of runs)verifyExportRun(c,s,run.id,limits,false);
}
export async function verifyPartialExport(c:Collector,id:string){
 const s=c.db.query<ExportSnapshot,[string]>('SELECT * FROM snapshots WHERE id=?').get(id)!;
 const {binding,item,limits}=await verifiedBinding(c,s),files=c.db.query<RawArtifact,[string]>("SELECT * FROM artifacts WHERE snapshot=? AND status='validated'").all(id);
 verifyPendingRuns(c,s,binding.limits);
 for(const file of files){if(!['data','layout'].includes(file.kind))throw new Error('export artifact identity');await verifyExportFile(c,file,limits.maxBytes,file.kind==='data'?item.url:item.layout!);const run=verifyExportRun(c,s,file.run,binding.limits,false);artifactTimes(file,run,c.deps.now(),s.mode==='raw-live');if(s.mode==='raw-live')await verifyExportHTTP(c,file,limits.maxBytes);}
}
export async function verifyExport(c:Collector,s:ExportSnapshot){
 const {binding,item,limits}=await verifiedBinding(c,s),files=exportFiles(c,s.id,item);
 for(const f of files){await verifyExportFile(c,f,limits.maxBytes,f.kind==='data'?item.url:item.layout!);const run=verifyExportRun(c,s,f.run,binding.limits,false);artifactTimes(f,run,c.deps.now(),s.mode==='raw-live');if(s.mode==='raw-live')await verifyExportHTTP(c,f,limits.maxBytes);}
 verifyExportRun(c,s,s.completion_run??'',binding.limits,true);if(exportVersion(item,files)!==s.version)throw new Error('export snapshot version');
 if((c.db.query('SELECT count(*) n FROM rows WHERE snapshot=?').get(s.id) as {n:number}).n!==0)throw new Error('raw export cannot claim semantic rows');
 if(s.status==='reused'&&!c.db.query("SELECT id FROM snapshots WHERE source=? AND selection=? AND version=? AND status='complete'").get(EXPORT_SOURCE.id,s.selection,s.version))throw new Error('export reuse history');
}
async function verifiedBinding(c:Collector,s:ExportSnapshot){
 const binding=c.db.query<{catalog:string;item:string;profile:string;limits:string},[string]>('SELECT * FROM export_bindings WHERE snapshot=?').get(s.id);
 if(!binding||binding.profile!=='raw-original'||!['raw-retained','raw-live'].includes(s.mode))throw new Error('export binding identity');
 const {item}=await selectedItem(c,s.selection,binding.catalog);if(JSON.stringify(item)!==binding.item)throw new Error('export catalog binding');const limits=exportLimits(JSON.parse(binding.limits));
 if(JSON.stringify(limits)!==binding.limits||limits.maxBytes!==s.max_bytes||limits.maxRows!==s.max_rows||s.row_count!==null)throw new Error('export limits provenance');return {binding,item,limits};
}
function exportAttempt(c:Collector,f:RawArtifact){
 const attempt=c.db.query<{path:string;headers:string;bytes:number;http_status:number;started_at:string;finished_at:string|null;status:string;error:string|null},[string,string,string]>("SELECT * FROM attempts WHERE run=? AND kind=? AND url=? AND status='validated' ORDER BY rowid DESC LIMIT 1").get(f.run,f.kind==='data'?'csv':'layout',f.url);
 if(!attempt||attempt.http_status!==200||f.http_status!==200||attempt.headers!==f.headers||attempt.bytes!==f.bytes||!/^[-0-9a-f]{36}\.attempt$/.test(attempt.path))throw new Error('export HTTP provenance');return attempt;
}
async function verifyExportHTTP(c:Collector,f:RawArtifact,maxBytes:number){
 const attempt=exportAttempt(c,f);
 const run=c.db.query<import('./provenance').Producer,[string]>('SELECT * FROM runs WHERE id=?').get(f.run)!;
 const finished=attemptTimes(attempt,run,c.deps.now());if(finished>Date.parse(f.retrieved_at??'')||finished>Date.parse(f.imported_at??''))throw new Error('artifact retrieval chronology');
 if((await fileDigest(join(c.root,attempt.path),maxBytes)).hash!==f.hash)throw new Error('export HTTP body provenance');
}
function verifyExportRun(c:Collector,s:ExportSnapshot,id:string,limits:string,terminal:boolean){
 const r=c.db.query<{snapshot:string;command:string;limits:string;started_at:string;finished_at:string|null;status:string;error:string|null},[string]>('SELECT * FROM runs WHERE id=?').get(id);
 if(!r||r.snapshot!==s.id||r.command!==s.mode||r.limits!==limits)throw new Error('export run provenance');
 verifyRunTimes(r,s.observed_at,terminal);producerBounds(r,c.deps.now());return r;
}
