import {Collector} from './collector';
import {setup,acquire,transport,robotsRedirect} from './live';
import {ROUTES} from './source';
import {exportSetup,exportLimits,startExport,retainCatalog,selectedItem,bindExport,retainExportFile,finishExport,verifyExport,verifyPartialExport,verifyUnboundExport,type ExportLimits} from './exports';
async function policyCatalog(c:Collector,http:ReturnType<typeof transport>,run:string,limits:ExportLimits){
 const work={maxRequests:limits.maxRequests,maxTotalBytes:limits.maxTotalBytes};
 const robots=await acquire(c,http,run,'robots',limits.maxRows,ROUTES.robots,work);
 if(robots.status===302)await acquire(c,http,run,'robots',limits.maxRows,robotsRedirect(ROUTES.robots,robots.headers),work);
 const page=await acquire(c,http,run,'discovery',limits.maxRows,ROUTES.discovery,work);return retainCatalog(c,page.file,run);
}
export async function discover(c:Collector,limits:ExportLimits=exportLimits()){
 return c.exclusive(async()=>{
  setup(c);limits=exportLimits(limits);const {id,run}=startExport(c,'@catalog','discovery',limits);
  try{const catalog=await policyCatalog(c,transport(c),run,limits);c.db.query("UPDATE snapshots SET status='catalog',completion_run=? WHERE id=?").run(run,id);c.finish(run,'succeeded');return catalog;}catch(error){c.finish(run,'failed',error);throw error;}
 });
}
type CachedExport={id:string;source:string;selection:string;mode:string;version:string;row_count:null;max_rows:number;max_bytes:number;observed_at:string;completion_run:string;status:string};
type CollectOptions={limits?:ExportLimits;catalogVersion?:string;version?:string;refresh?:boolean};
async function reuse(c:Collector,selection:string,options:CollectOptions,limits:ExportLimits){
 if(options.refresh)return null;
 const cached=options.version?c.db.query<CachedExport,[string,string]>("SELECT * FROM snapshots WHERE source='tax-office/exports' AND selection=? AND version=? AND status IN ('complete','reused') ORDER BY rowid DESC LIMIT 1").get(selection,options.version):c.db.query<CachedExport,[string]>("SELECT * FROM snapshots WHERE source='tax-office/exports' AND selection=? AND status='complete' ORDER BY rowid DESC LIMIT 1").get(selection);
 if(cached){await verifyExport(c,cached);if(options.catalogVersion){const binding=c.db.query<{catalog:string},[string]>('SELECT catalog FROM export_bindings WHERE snapshot=?').get(cached.id);if(binding?.catalog!==options.catalogVersion)throw new Error('cached observation belongs to a different catalog version; select its --version or explicitly refresh');}const files=c.db.query<{bytes:number},[string]>('SELECT bytes FROM artifacts WHERE snapshot=?').all(cached.id);if(files.some(f=>f.bytes>limits.maxBytes))throw new Error('byte ceiling');return {snapshot:cached.id,version:cached.version,selection,rows:null,profile:'raw-original',reused:true};}
 if(options.version)throw new Error('retained export version not found; remote historical versions are not guessed');return null;
}
async function preflight(c:Collector,selection:string,limits:ExportLimits,refresh:boolean){
 const pending=c.db.query<{id:string;status:string},[string]>("SELECT id,status FROM snapshots WHERE source='tax-office/exports' AND selection=? AND status IN ('collecting','abandoned')").all(selection);
 for(const s of pending){
  const binding=c.db.query<{limits:string},[string]>('SELECT limits FROM export_bindings WHERE snapshot=?').get(s.id);
  if(binding){await verifyPartialExport(c,s.id);if(s.status==='collecting'&&!refresh&&binding.limits!==JSON.stringify(limits))throw new Error('checkpoint work limits changed; explicit refresh required');}
  else {verifyUnboundExport(c,s.id);if(s.status==='collecting'&&!refresh)throw new Error('unbound export checkpoint; explicit refresh required');}
 }
}
function resume(c:Collector,selection:string,limits:ExportLimits,refresh:boolean){
 if(refresh)c.db.query("UPDATE snapshots SET status='abandoned' WHERE source='tax-office/exports' AND selection=? AND mode='raw-live' AND status='collecting'").run(selection);
 const prior=c.db.query<{id:string;catalog:string;item:string},[string,string]>("SELECT s.id,b.catalog,b.item FROM snapshots s JOIN export_bindings b ON b.snapshot=s.id WHERE s.source='tax-office/exports' AND s.selection=? AND s.mode='raw-live' AND s.status='collecting' AND b.limits=? ORDER BY s.rowid DESC LIMIT 1").get(selection,JSON.stringify(limits));
 const started=prior?{id:prior.id,run:crypto.randomUUID()}:startExport(c,selection,'raw-live',limits);
 if(prior)c.db.query("INSERT INTO runs VALUES(?,?,?,'running',?,NULL,NULL,?)").run(started.run,started.id,'raw-live',c.stamp(),JSON.stringify(limits));return {...started,prior};
}
function currentItem(current:{version:string;items:import('./catalog').Item[]},selection:string,catalogVersion:string|undefined,prior:{item:string}|null){
 const item=current.items.find(i=>i.id===selection);if(!item)throw new Error('selected export no longer published');
 if(catalogVersion&&current.version!==catalogVersion)throw new Error('selected retained catalog is not the current remote catalog');
 if(prior&&JSON.stringify(item)!==prior.item)throw new Error('export checkpoint source changed; explicit refresh required');return item;
}
async function acquireFiles(c:Collector,http:ReturnType<typeof transport>,id:string,run:string,item:import('./catalog').Item,limits:ExportLimits){
 const files:[('data'|'layout'),string][]=[['data',item.url]];if(item.layout)files.push(['layout',item.layout]);
 for(const [kind,url] of files){
  const existing=c.db.query<{id:string},[string,string]>("SELECT id FROM artifacts WHERE snapshot=? AND kind=? AND status='validated'").get(id,kind);if(existing)continue;
  const artifact=await acquire(c,http,run,kind==='data'?'csv':'layout',limits.maxRows,url,{maxBytes:limits.maxBytes,maxRequests:limits.maxRequests,maxTotalBytes:limits.maxTotalBytes,rawOnly:true,fileOnly:true});await retainExportFile(c,id,run,kind,artifact.file,url,limits,{headers:artifact.headers,status:artifact.status});
 }
}
export async function collectExport(c:Collector,selection:string,options:CollectOptions={}){
 return c.exclusive(async()=>{
  const limits=exportLimits(options.limits);
  if(options.version&&options.refresh)throw new Error('retained version selector cannot request refresh');
  exportSetup(c);await preflight(c,selection,limits,!!options.refresh);
  const cached=await reuse(c,selection,options,limits);if(cached)return cached;
  await selectedItem(c,selection,options.catalogVersion);
  setup(c);const http=transport(c),{id,run,prior}=resume(c,selection,limits,!!options.refresh);
  try{
   if(prior)await verifyPartialExport(c,id);
   const current=await policyCatalog(c,http,run,limits),item=currentItem(current,selection,options.catalogVersion,prior);
   if(!prior)bindExport(c,id,current.version,item,limits);
   await acquireFiles(c,http,id,run,item,limits);
   const result=await finishExport(c,id,run,item,limits);await c.verify();return result;
  }catch(error){c.finish(run,'failed',error);throw error;}
 });
}
