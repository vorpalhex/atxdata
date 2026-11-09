import {Database} from 'bun:sqlite';import {createHash} from 'node:crypto';import {join} from 'node:path';import {open,readFile} from 'node:fs/promises';import {promote,statFile} from '../../civicclerk-consume/src/archive';import {digest,LIMITS,withZip,inventory} from './archive';
export const LIVE_SCHEMA=`CREATE TABLE IF NOT EXISTS request_policy(id INTEGER PRIMARY KEY CHECK(id=1),not_before INTEGER NOT NULL,delay_ms INTEGER NOT NULL,robots TEXT);
CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,url TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER,status INTEGER,bytes INTEGER,error TEXT);
CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,label TEXT NOT NULL,observed TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS acquisitions(id TEXT PRIMARY KEY REFERENCES catalog(id),path TEXT NOT NULL,hash TEXT NOT NULL,bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_observations(id TEXT PRIMARY KEY,html TEXT NOT NULL,hash TEXT NOT NULL,context TEXT NOT NULL,observed TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_entries(observation TEXT NOT NULL REFERENCES catalog_observations(id),id TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(observation,id));
CREATE TABLE IF NOT EXISTS acquisition_versions(version TEXT PRIMARY KEY,id TEXT NOT NULL,observation TEXT NOT NULL REFERENCES catalog_observations(id),path TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS live_state(id INTEGER PRIMARY KEY CHECK(id=1),format INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS request_evidence(request_id TEXT PRIMARY KEY REFERENCES requests(id),body_hash TEXT NOT NULL,headers TEXT NOT NULL);`;
const IMMUTABLE=['catalog_observations','catalog_entries','acquisition_versions','live_state','request_evidence'];
function protectHistory(db:Database){for(const table of IMMUTABLE)for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable provenance'); END;`);}

const LIVE_TABLES=['request_policy','requests','catalog','acquisitions','catalog_observations','catalog_entries','acquisition_versions'];
export function preflightLive(db:Database,activeRequest?:string){
 const tables=new Set(db.query<{name:string},[]>('SELECT name FROM sqlite_master WHERE type=\'table\'').all().map(r=>r.name));
 if(![...LIVE_TABLES,'live_state','request_evidence'].some(n=>tables.has(n)))return false;
 if(tables.has('live_state')||tables.has('request_evidence'))validateLiveFormat(db,tables);
 for(const n of LIVE_TABLES)if(!tables.has(n))throw new Error(`missing persisted live table ${n}; operator review`);
 const policy=persistedPolicy(db);validateLedger(db,activeRequest);validateCooldown(db,policy,tables.has('request_evidence'));return true;
}
function completionEvidence(db:Database,available:boolean){
 if(!available){
  if(db.query('SELECT id FROM requests WHERE finished IS NOT NULL LIMIT 1').get())
   throw new Error('completed cooldown evidence unavailable; operator review');
  return [];
 }
 return db.query<any,[]>('SELECT r.finished,e.headers FROM requests r LEFT JOIN request_evidence e ON e.request_id=r.id WHERE r.finished IS NOT NULL').all();
}
function completionDeadline(row:any,delay:number){
 if(typeof row.headers!=='string')
  throw new Error('completed cooldown evidence unavailable; operator review');
 const pairs=JSON.parse(row.headers);
 if(!validHeaders(pairs))throw new Error('invalid completed cooldown header evidence');
 const deadline=row.finished+Math.max(delay,responseDelay(new Headers(pairs),row.finished));
 if(!safe(deadline))throw new Error('unsafe completed cooldown obligation; operator review');
 return deadline;
}
function validateCooldown(db:Database,policy:any,evidenceAvailable:boolean){
 for(const row of completionEvidence(db,evidenceAvailable))
  if(policy.not_before<completionDeadline(row,policy.delay_ms))
   throw new Error('persisted cooldown below retained completion obligation; operator review');
}
export function initializeLive(db:Database){
 const existing=preflightLive(db);
 if(db.query("SELECT name FROM sqlite_master WHERE name='live_state'").get())return;
 db.exec(LIVE_SCHEMA);protectHistory(db);
 if(!existing)db.query('INSERT INTO request_policy VALUES(1,0,3000,NULL)').run();
 db.query('INSERT INTO live_state VALUES(1,2)').run();
}
function validateLiveFormat(db:Database,tables:Set<string>){
 if(!tables.has('live_state')||!tables.has('request_evidence'))throw new Error('missing persisted live evidence/state');
 const rows=db.query<any,[]>('SELECT * FROM live_state').all();if(rows.length!==1||rows[0].id!==1||rows[0].format!==2)throw new Error('corrupt live state format');
}
function safe(n:unknown){return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;}
function persistedPolicy(db:Database){
 const rows=db.query<any,[]>('SELECT * FROM request_policy').all();const p=rows[0];
 if(rows.length!==1||p.id!==1||!safe(p.not_before)||!safe(p.delay_ms))throw new Error('corrupt persisted request policy');
 if(p.robots!==null)validateRobots(p.robots);
 if(p.delay_ms<robotsDelay(p.robots))throw new Error('persisted policy delay contradicts retained robots/minimum');
 return p;
}
function crawlDelay(text:string){const value=text.split('#')[0]!.trim();if(!/^\d+(?:\.\d+)?$/.test(value))throw new Error('invalid retained robots crawl-delay');const delay=Math.ceil(Number(value)*1000);if(!safe(delay))throw new Error('unsafe robots delay');return delay;}
function robotsDelay(robots:string|null){
 const delays=[...(robots??'').matchAll(/^Crawl-delay:([^\r\n]*)/gim)].map(m=>crawlDelay(m[1]!));
 return Math.max(3000,...delays);
}
function validateRobots(robots:unknown){
 if(typeof robots!=='string'||robots.length>2097152||!/^User-agent:\s*\S+/im.test(robots)||/[\x00]/.test(robots))throw new Error('corrupt robots policy');
}
function validateLedger(db:Database,activeRequest=''){
 if(db.query('SELECT id FROM requests WHERE finished IS NULL AND id<>? LIMIT 1').get(activeRequest))throw new Error('unfinished request requires operator review');
 for(const r of db.query<any,[]>('SELECT * FROM requests').all()){
 if(r.id===activeRequest&&r.finished===null){if(!safe(r.started))throw new Error('corrupt active ledger');continue;}
 completedRequest(r);
 }
}
function completedRequest(r:any){
 if(!safe(r.started)||!safe(r.finished)||r.finished<r.started||!safe(r.bytes))throw new Error('corrupt request policy ledger');
 if(r.status!==null)requestStatus(r.status);official(r.url);
}
function requestStatus(status:unknown){if(typeof status!=='number'||!Number.isSafeInteger(status)||status<100||status>599)throw new Error('corrupt request status ledger');}

function validateBudgets(o:LiveOptions){for(const n of [o.maxRequests,o.maxBytes])if(!Number.isSafeInteger(n)||n<1)throw new Error('explicit positive request/byte budgets');}
export type LiveOptions={maxRequests:number;maxBytes:number;refresh?:boolean;transport?:(url:string)=>Promise<Response>;clock?:()=>number;sleep?:(ms:number)=>Promise<void>};
function official(value:string){const u=new URL(value);if(u.origin!=='https://traviscad.org'||u.username||u.password||u.hash)throw new Error('TCAD authority required');return u;}
export function catalogLinks(html:string){
 const result=new Map<string,{id:string;url:string;label:string}>();
 const parsed=Bun.spawnSync(['python3',join(import.meta.dir,'catalog.py')],{stdin:Buffer.from(html),maxBuffer:4194304});if(parsed.exitCode)throw new Error('catalog HTML parser');
 for(const [href,label] of JSON.parse(parsed.stdout.toString()) as [string,string][]){
 let u:URL;try{u=official(new URL(href,'https://traviscad.org/publicinformation').href);}catch{continue;}
 if(!u.pathname.startsWith('/wp-content/largefiles/')||!u.pathname.toLowerCase().endsWith('.zip'))continue;
 const url=u.href,id=createHash('sha256').update(url).digest('hex');result.set(id,{id,url,label});
 }return [...result.values()];
}
const DISCOVERY='https://traviscad.org/publicinformation';
type HeaderPairs=[string,string][];
export type CatalogContext={kind:'operator-import';sourceURL:string;status:null;headers:HeaderPairs}|{kind:'http';sourceURL:string;status:number;headers:HeaderPairs;requestId:string};
function validHeaders(value:unknown):value is HeaderPairs{
 if(!Array.isArray(value))return false;
 return value.every(pair=>Array.isArray(pair)&&pair.length===2&&typeof pair[0]==='string'&&typeof pair[1]==='string'&&/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(pair[0])&&!/[\r\n\0]/.test(pair[1]));
}
function contextShape(value:unknown):asserts value is CatalogContext{
 if(!value||typeof value!=='object')throw new Error('catalog context object required');
 const c=value as any;if(c.sourceURL!==DISCOVERY||!validHeaders(c.headers))throw new Error('catalog context route/header contract');
 if(c.kind==='operator-import')operatorContext(c);else httpContext(c);
}
function operatorContext(c:any){if(c.status!==null||c.headers.length||'requestId' in c)throw new Error('operator context must have unknown HTTP metadata');}
function httpContext(c:any){if(c.kind!=='http'||c.status!==200||typeof c.requestId!=='string'||!c.requestId)throw new Error('HTTP catalog context requires successful producing request');}

function validateContext(db:Database,html:string,value:unknown):asserts value is CatalogContext{
 contextShape(value);if(value.kind==='operator-import')return;
 const row=db.query<any,[string]>('SELECT r.*,e.body_hash,e.headers FROM requests r JOIN request_evidence e ON e.request_id=r.id WHERE r.id=?').get(value.requestId);
 producingRequest(row);
 if(row.bytes!==Buffer.byteLength(html)||row.body_hash!==createHash('sha256').update(html).digest('hex')||row.headers!==JSON.stringify(value.headers))throw new Error('catalog context response does not match request evidence');
}
function producingRequest(row:any){if(!row||row.finished===null||row.status!==200||row.error!==null||row.url!==DISCOVERY)throw new Error('catalog context producing request is not completed successfully');}
export function retainCatalog(db:Database,html:string,context:CatalogContext={kind:'operator-import',sourceURL:DISCOVERY,status:null,headers:[]}){
 initializeLive(db);if(Buffer.byteLength(html)>2097152)throw new Error('metadata ceiling');validateContext(db,html,context);
 const links=catalogLinks(html),observation=crypto.randomUUID(),observed=new Date().toISOString();
 db.transaction(()=>{
 db.query('INSERT INTO catalog_observations VALUES(?,?,?,?,?)').run(observation,html,createHash('sha256').update(html).digest('hex'),JSON.stringify(context),observed);
 for(const l of links){db.query('INSERT INTO catalog_entries VALUES(?,?,?,?)').run(observation,l.id,l.url,l.label);db.query('INSERT INTO catalog VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,observed=excluded.observed').run(l.id,l.url,l.label,observed);}
 }).immediate();return links;
}
function catalogBinding(db:Database,item:any){
 const e=db.query<any,[string,string]>('SELECT e.*,o.html,o.hash,o.context FROM catalog_entries e JOIN catalog_observations o ON o.id=e.observation WHERE e.id=? AND o.observed=? ORDER BY o.rowid DESC LIMIT 1').get(item.id,item.observed);
 if(!e||e.url!==item.url||e.label!==item.label||createHash('sha256').update(e.html).digest('hex')!==e.hash)throw new Error('catalog observation provenance; operator review');
 validateContext(db,e.html,JSON.parse(e.context));
 if(!catalogLinks(e.html).some(l=>l.id===item.id&&l.url===item.url&&l.label===item.label))throw new Error('catalog publication provenance');
 return e;
}

async function responseChunks(response:Response,consume:(chunk:Buffer)=>Promise<void>){
 if(!response.body)throw new Error('empty response');
 const reader=response.body.getReader();
 try{for(;;){const r=await reader.read();if(r.done)break;await consume(Buffer.from(r.value));}}finally{await reader.cancel();}
}
function responseDelay(headers:Headers,now:number){
 const retry=headers.get('retry-after');let extra=0;
 if(retry){extra=/^\d+$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-now);if(!Number.isFinite(extra))extra=86400000;}
 // X-RateLimit Reset values are epoch seconds; non-X Reset values are relative seconds, independent of the observation clock.
 for(const [name,value] of headers){if(/^(x-)?ratelimit/i.test(name)){extra=Math.max(extra,86400000);if(/reset/i.test(name)&&/^\d+(?:\.\d+)?$/.test(value)){const n=Number(value)*1000;extra=Math.max(extra,/^x-/i.test(name)?Math.max(0,n-now):n);}}}
 return extra;
}
class Session{
 context:CatalogContext|null=null;requests=0;bytes=0;clock:()=>number;sleep:(ms:number)=>Promise<void>;
 constructor(private db:Database,private o:LiveOptions){validateBudgets(o);initializeLive(db);persistedPolicy(db);validateLedger(db);this.clock=o.clock??Date.now;this.sleep=o.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));}
 async reserve(url:string){
 for(;;){
 const reserved=this.db.transaction(()=>{
 preflightLive(this.db);const p=persistedPolicy(this.db),now=this.clock();if(!safe(now))throw new Error('unsafe policy clock');
 if(now<p.not_before)return {wait:p.not_before-now,id:null,delay:p.delay_ms};
 const id=crypto.randomUUID();this.db.query('INSERT INTO requests(id,url,started) VALUES(?,?,?)').run(id,url,now);return {wait:0,id,delay:p.delay_ms};
 }).immediate();
 if(reserved.id)return reserved;
 await this.sleep(Math.min(86400000,reserved.wait));
 }
 }
 async get(url:string,consume:(chunk:Buffer)=>Promise<void>){
 official(url);if(++this.requests>this.o.maxRequests)throw new Error('request budget');
 const reservation=await this.reserve(url),id=reservation.id;let status:number|null=null,bytes=0,delay=reservation.delay,extra=0;const bodyHash=createHash('sha256');let headers:HeaderPairs=[];
 try{
 preflightLive(this.db,id);
 const response=await (this.o.transport?this.o.transport(url):fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000),credentials:'omit',headers:{'User-Agent':'tcad-consume/1.0'}}));status=response.status;this.context={kind:'http',sourceURL:url,status,headers:[...response.headers],requestId:id};headers=[...response.headers];
 extra=responseDelay(response.headers,this.clock());
 if(status!==200){await response.body?.cancel();throw new Error(`HTTP ${status}; no automatic retries/redirects`);}
 await responseChunks(response,async chunk=>{bodyHash.update(chunk);bytes+=chunk.length;this.bytes+=chunk.length;if(this.bytes>this.o.maxBytes)throw new Error('byte budget');await consume(chunk);});
 return bytes;
 }catch(e){preflightLive(this.db,id);this.db.query('UPDATE requests SET error=? WHERE id=?').run(String(e),id);throw e;}
 finally{this.finish(id,status,bytes,delay,extra,bodyHash.digest('hex'),headers);}
 }
 finish(id:string,status:number|null,bytes:number,delay:number,extra:number,hash:string,headers:HeaderPairs){
 this.db.transaction(()=>{
 preflightLive(this.db,id);const end=this.clock(),gate=end+Math.max(delay,extra);if(!safe(end)||!safe(gate))throw new Error('unsafe completed request gate');
 this.db.query('UPDATE requests SET finished=?,status=?,bytes=? WHERE id=?').run(end,status,bytes,id);
 this.db.query('INSERT INTO request_evidence VALUES(?,?,?)').run(id,hash,JSON.stringify(headers));
 this.db.query('UPDATE request_policy SET not_before=max(not_before,?) WHERE id=1').run(gate);
 }).immediate();
 }
 async text(url:string){const chunks:Buffer[]=[];let size=0;await this.get(url,async b=>{size+=b.length;if(size>2097152)throw new Error('metadata ceiling');chunks.push(b);});return Buffer.concat(chunks).toString('utf8');}
 async policy(){
 const row=persistedPolicy(this.db);let robots=row.robots;
 if(robots===null){robots=await this.text('https://traviscad.org/robots.txt');validateRobots(robots);const delay=robotsDelay(robots);this.db.query('UPDATE request_policy SET robots=?,delay_ms=?,not_before=max(not_before,?) WHERE id=1').run(robots,delay,this.clock()+delay);}
 if(/^Disallow:[ \t]*[^\s#]/im.test(robots))throw new Error('robots disallow requires operator review');
 }
}
const operationQueues=new Map<string,Promise<void>>();
const memoryKeys=new WeakMap<Database,string>();
function operationKey(db:Database){if(db.filename!==':memory:')return db.filename;let key=memoryKeys.get(db);if(!key){key=crypto.randomUUID();memoryKeys.set(db,key);}return key;}
async function serializedLive<T>(db:Database,operation:()=>Promise<T>){
 const key=operationKey(db),prior=operationQueues.get(key)??Promise.resolve();let release!:()=>void;const tail=new Promise<void>(r=>{release=r;});const queued=prior.then(()=>tail);operationQueues.set(key,queued);
 await prior;try{return await operation();}finally{release();if(operationQueues.get(key)===queued)operationQueues.delete(key);}
}
export function discover(db:Database,root:string,o:LiveOptions){return serializedLive(db,()=>discoverSerial(db,root,o));}
async function discoverSerial(db:Database,_root:string,o:LiveOptions){const s=new Session(db,o);await s.policy();const html=await s.text('https://traviscad.org/publicinformation');return retainCatalog(db,html,s.context!);}
function originalCatalogObservation(db:Database,observation:string,id:string){
 const e=db.query<any,[string,string]>('SELECT e.*,o.html,o.hash,o.context FROM catalog_entries e JOIN catalog_observations o ON o.id=e.observation WHERE e.observation=? AND e.id=?').get(observation,id);
 if(!e||createHash('sha256').update(e.html).digest('hex')!==e.hash)throw new Error('acquisition catalog observation provenance');
 validateContext(db,e.html,JSON.parse(e.context));
 if(createHash('sha256').update(official(e.url).href).digest('hex')!==id)throw new Error('acquisition catalog identity provenance');
 if(!catalogLinks(e.html).some(l=>l.id===id&&l.url===e.url&&l.label===e.label))throw new Error('acquisition catalog publication provenance');
}
async function verifyAcquisition(db:Database,root:string,id:string,prior:any){
 const robots=persistedPolicy(db).robots;if(robots===null||/^Disallow:[ \t]*[^\s#]/im.test(robots))throw new Error('cached robots policy requires operator review');
 const binding=db.query<any,[string]>('SELECT * FROM acquisition_versions WHERE path=?').get(prior.path);
 if(!binding||binding.id!==id||binding.hash!==prior.hash||binding.bytes!==prior.bytes)throw new Error('acquisition version provenance');
 originalCatalogObservation(db,binding.observation,id);await verifyArtifact(root,id,prior,binding.version);
}
async function verifyArtifact(root:string,id:string,prior:any,version:string){
 if(![id+'.zip',id+'-'+version+'.zip'].includes(prior.path))throw new Error('acquisition provenance path');
 if(!safe(prior.bytes))throw new Error('acquisition provenance bytes');
 const file=await statFile(join(root,prior.path));if(!file)throw new Error('acquisition provenance missing file');
 if(file.size!==prior.bytes)throw new Error('acquisition provenance size');
 if(await digest(join(root,prior.path),LIMITS.compressed)!==prior.hash)throw new Error('acquisition provenance hash');
}
export function acquire(db:Database,root:string,id:string,o:LiveOptions){return serializedLive(db,()=>acquireSerial(db,root,id,o));}
async function acquireSerial(db:Database,root:string,id:string,o:LiveOptions){
 const s=new Session(db,o);const item=db.query<any,[string]>('SELECT * FROM catalog WHERE id=?').get(id);if(!item)throw new Error('select published catalog id');
 if(createHash('sha256').update(official(item.url).href).digest('hex')!==id)throw new Error('catalog provenance');
 const entry=catalogBinding(db,item);
 const prior=db.query<any,[string]>('SELECT * FROM acquisitions WHERE id=?').get(id);
 if(prior){await verifyAcquisition(db,root,id,prior);if(!o.refresh){preflightLive(db);return {...prior,reused:true};}}
 const version=crypto.randomUUID(),path=prior?id+'-'+version+'.zip':id+'.zip',final=join(root,path);for(const name of [final,final+'.pending'])if(await statFile(name))throw new Error('existing acquisition requires operator review');
 await s.policy();preflightLive(db);const h=await open(final+'.pending','wx',0o600);let bytes:number;
 try{bytes=await s.get(item.url,async b=>{await h.writeFile(b);});await h.sync();}finally{await h.close();}
 const hash=await digest(final+'.pending',LIMITS.compressed);
 // Validation is deliberately generic ZIP inventory, not a claim of interpreted records.
 // Promotion is a no-clobber checkpoint; uncertain finals are never silently adopted.
 await withZip(final+'.pending',LIMITS.compressed,async z=>{await inventory(z);});
 preflightLive(db);await promote(final);preflightLive(db);db.transaction(()=>{db.query('INSERT INTO acquisition_versions VALUES(?,?,?,?,?,?)').run(version,id,entry.observation,path,hash,bytes);db.query('INSERT INTO acquisitions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,hash=excluded.hash,bytes=excluded.bytes').run(id,path,hash,bytes);}).immediate();return {id,path,hash,bytes,reused:false};
}
