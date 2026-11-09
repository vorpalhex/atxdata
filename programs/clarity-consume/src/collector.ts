import { Database } from 'bun:sqlite';
import { resolve,join,sep } from 'node:path';
import { readFile,open } from 'node:fs/promises';
import { archiveLock,statFile,promote } from '../../civicclerk-consume/src/archive';
import { PoliteHttpClient } from '../../civicclerk-consume/src/http';
import { CAPS,hash,decode,COUNTY,HOST,OFFICIAL,catalog,token,isoDate,sourceDate,selectDate } from './source';
import { parseXml,xmlFromZip,reconcile } from './results';

export type Dependencies={fetch:(url:string,init:RequestInit)=>Promise<Response>;now:()=>number;sleep:(ms:number)=>Promise<void>;random:()=>number};
type FileRow={id:string;observation:string;name:string;url:string;path:string;status:string;headers:string;http_status:number;encoded_hash:string;decoded_hash:string;bytes:number};
type Observation={id:string;election:string;version:string|null;after_version:string|null;status:string;coverage:string|null};
const SCHEMA=`
 PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,url TEXT NOT NULL,label TEXT NOT NULL,state_id TEXT NOT NULL,county_id TEXT NOT NULL);
 INSERT OR IGNORE INTO sources VALUES('TX/Travis','${COUNTY}','Travis','9','1239');
 CREATE TABLE IF NOT EXISTS elections(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES sources(id),label TEXT NOT NULL,event_date TEXT NOT NULL,metadata TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,election TEXT REFERENCES elections(id),version TEXT,after_version TEXT,status TEXT NOT NULL,started_at TEXT NOT NULL,coverage TEXT,publication_date TEXT);
 CREATE TABLE IF NOT EXISTS selections(observation TEXT PRIMARY KEY REFERENCES observations(id),election TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,observation TEXT REFERENCES observations(id),command TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,error TEXT,limits TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cooldown(id INTEGER PRIMARY KEY CHECK(id=1),not_before REAL NOT NULL);
 INSERT OR IGNORE INTO cooldown VALUES(1,0);
 CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,observation TEXT NOT NULL REFERENCES observations(id),run TEXT NOT NULL REFERENCES runs(id),name TEXT NOT NULL,url TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,retrieved_at TEXT,http_status INTEGER,headers TEXT,encoded_hash TEXT,decoded_hash TEXT,bytes INTEGER,error TEXT);
 CREATE TABLE IF NOT EXISTS result_rows(observation TEXT NOT NULL REFERENCES observations(id),contest TEXT NOT NULL,choice TEXT NOT NULL,vote_type TEXT NOT NULL,precinct TEXT NOT NULL,votes INTEGER NOT NULL CHECK(votes>=0),PRIMARY KEY(observation,contest,choice,vote_type,precinct));
`;
export class Collector {
  readonly db:Database;
  private readonly deps:Dependencies;
  private readonly http:PoliteHttpClient;
  private active=false;
  private readonly statuses=new WeakMap<Response,number>();
  private constructor(readonly root:string,private readonly release:()=>Promise<void>,dependencies:Partial<Dependencies>) {
    this.deps={fetch:(url,init)=>Bun.fetch(url,{...init,decompress:false}),now:Date.now,sleep:Bun.sleep,random:Math.random,...dependencies};
    this.db=new Database(join(root,'state.sqlite'),{strict:true});
    this.db.exec(SCHEMA);
    this.db.run("UPDATE runs SET status='interrupted',error='writer ended before checkpoint' WHERE status='running'");
    this.db.run("UPDATE files SET status='interrupted',error='incomplete body retained' WHERE status IN ('requesting','receiving')");
    this.http=new PoliteHttpClient({maxRetries:0,minIntervalMs:3000,timeoutMs:120000,userAgent:'atxdata-clarity-consume/0.1'},{...this.deps,fetch:async(url,init)=>{
      const original=await this.deps.fetch(url,init);
      // Keep the existing full-body queue, but let this adapter archive error bodies too.
      const envelope=new Response(original.body,{status:200,headers:original.headers});
      this.statuses.set(envelope,original.status);return envelope;
    }});
  }
  static async open(root:string,deps:Partial<Dependencies>={}):Promise<Collector> {
    const repository=resolve(import.meta.dir,'../../..');
    if(root===repository || root.startsWith(repository+sep)) throw new Error('runtime state must be outside source checkout');
    const release=await archiveLock(root);
    try {for(const file of ['state.sqlite','state.sqlite-wal','state.sqlite-shm']) await statFile(join(root,file));return new Collector(root,release,deps);}
    catch(e){await release();throw e;}
  }
  async close(){this.db.close();await this.release();}
  private stamp(){return new Date(this.deps.now()).toISOString();}
  private cooldown(){return (this.db.query('SELECT not_before FROM cooldown WHERE id=1').get() as {not_before:number}).not_before;}
  private defer(until:number){this.db.query('UPDATE cooldown SET not_before=max(not_before,?) WHERE id=1').run(until);}
  private async wait(){if(this.cooldown()===Number.MAX_SAFE_INTEGER)throw new Error('ambiguous server policy requires operator review');while(this.cooldown()>this.deps.now()) await this.deps.sleep(Math.min(2_147_483_647,this.cooldown()-this.deps.now()));}
  private run(obs:string,command:string):string {
    const id=crypto.randomUUID();this.db.query("INSERT INTO runs(id,observation,command,status,started_at,limits) VALUES(?,?,?,'running',?,?)").run(id,obs,command,this.stamp(),JSON.stringify(CAPS));return id;
  }
  private finish(run:string,status:string,error:unknown=null){this.db.query('UPDATE runs SET status=?,finished_at=?,error=? WHERE id=?').run(status,this.stamp(),error===null?null:String(error),run);}
  private budget(run:string){
    const row=this.db.query('SELECT count(*) n,coalesce(sum(bytes),0) bytes FROM files WHERE run=?').get(run) as {n:number;bytes:number};
    if(row.n>=CAPS.requests || row.n>=CAPS.files || row.bytes>=CAPS.totalBytes) throw new Error('run request/file/byte ceiling');return CAPS.totalBytes-row.bytes;
  }
  private async cached(row:FileRow):Promise<Buffer>{
    archivedFilename(row.path);
    const info=await statFile(join(this.root,row.path));
    if(!info?.isFile() || info.size!==row.bytes || info.size>CAPS.fileBytes) throw new Error('retained file missing/size mismatch');
    const raw=await readFile(join(this.root,row.path));
    if(hash(raw)!==row.encoded_hash) throw new Error('retained hash mismatch');
    const decoded=decode(raw,JSON.parse(row.headers)['content-encoding']??null,row.name==='export'?CAPS.fileBytes:CAPS.decodedBytes);
    if(decoded.decodedHash!==row.decoded_hash) throw new Error('retained decoded hash mismatch');return decoded.bytes;
  }
  private async acquire(obs:string,run:string,name:string,url:string,mime:string,validate:(bytes:Buffer,status:number)=>void,fresh=false):Promise<Buffer> {
    if(!fresh){const cached=await this.reuse(obs,name,url,validate);if(cached)return cached;}
    const previous=this.db.query('SELECT count(*) n FROM files WHERE observation=? AND name=? AND status<>\'downloaded\'').get(obs,name) as {n:number};
    for(let attempt=previous.n;attempt<4;attempt++){
      const remaining=this.budget(run);await this.wait();
      const id=crypto.randomUUID(),path=`${id}.body`;
      this.db.query("INSERT INTO files(id,observation,run,name,url,path,status,started_at,bytes) VALUES(?,?,?,?,?,?,'requesting',?,0)").run(id,obs,run,name,url,path,this.stamp());
      try{return await this.transfer(id,url,path,name,mime,remaining,validate);}
      catch(error){
        this.db.query("UPDATE files SET status='failed',retrieved_at=?,error=? WHERE id=?").run(this.stamp(),String(error),id);
        const row=this.db.query('SELECT http_status FROM files WHERE id=?').get(id) as {http_status:number|null};
        if(!retryable(row.http_status,error) || attempt===3)throw error;
        this.defer(this.deps.now()+Math.max(3000,2000*2**attempt)+this.deps.random()*1000);
      }finally{this.defer(this.deps.now()+3000);}
    }
    throw new Error('persisted acquisition attempt budget exhausted');
  }
  private async reuse(obs:string,name:string,url:string,validate:(b:Buffer,status:number)=>void){
    const row=this.db.query<FileRow,[string,string,string]>("SELECT * FROM files WHERE observation=? AND name=? AND url=? AND status='downloaded' ORDER BY rowid DESC LIMIT 1").get(obs,name,url);
    if(!row)return undefined;const b=await this.cached(row);validate(b,row.http_status);return b;
  }
  private async transfer(id:string,url:string,path:string,name:string,mime:string,remaining:number,validate:(b:Buffer,status:number)=>void){
    return this.http.request(url,async(response)=>{
      const status=this.statuses.get(response)??response.status,target=join(this.root,path);
      this.recordHeaders(id,response,status);
      const raw=await this.consume(response,target,Math.min(CAPS.fileBytes,remaining),id);
      const decoded=decode(raw,response.headers.get('content-encoding'),name==='export'?CAPS.fileBytes:CAPS.decodedBytes);
      this.db.query('UPDATE files SET encoded_hash=?,decoded_hash=? WHERE id=?').run(decoded.encodedHash,decoded.decodedHash,id);
      requireHttp(status,name,response.headers.get('content-type'),mime);
      validate(decoded.bytes,status);await promote(target);
      this.db.query("UPDATE files SET status='downloaded',retrieved_at=?,encoded_hash=?,decoded_hash=?,bytes=? WHERE id=?").run(this.stamp(),decoded.encodedHash,decoded.decodedHash,raw.length,id);
      return decoded.bytes;
    });
  }
  private recordHeaders(id:string,response:Response,status:number){
    this.db.query("UPDATE files SET status='receiving',http_status=?,headers=? WHERE id=?").run(status,JSON.stringify(Object.fromEntries(response.headers)),id);
    try{this.defer(this.deps.now()+serverDelay(response.headers,this.deps.now()));}catch(error){this.defer(Number.MAX_SAFE_INTEGER);throw error;}
  }
  private async consume(response:Response,target:string,limit:number,id:string):Promise<Buffer>{
    const declared=declaredLength(response.headers,limit);
    if(!response.body) throw new Error('empty body');
    // Own native response bodies before filesystem awaits (Tax/ArcGIS pattern).
    const reader=response.body.getReader(),state={ended:false};let handle:Awaited<ReturnType<typeof open>>|undefined,bytes=0,failure:{error:unknown}|undefined;
    try{
      handle=await open(target+'.pending','wx',0o600);
      bytes=await this.writeChunks(reader,handle,limit,id,state);
      await handle.sync();
    }catch(error){failure={error};throw error;}
    finally{
      const errors=await releaseBody(reader,handle,state.ended);
      if(errors.length)throw new AggregateError(failure?[failure.error,...errors]:errors,'body cleanup failed',{cause:failure?.error});
    }
    if(declared!==null && Number(declared)!==bytes) throw new Error('content length mismatch');
    return readFile(target+'.pending');
  }
  private async writeChunks(reader:ReadableStreamDefaultReader<Uint8Array>,handle:Awaited<ReturnType<typeof open>>,limit:number,id:string,state:{ended:boolean}){
    let bytes=0;
    for(;;){let chunk:Awaited<ReturnType<typeof reader.read>>;
      try{chunk=await reader.read();}catch(error){state.ended=true;throw error;}
      const {done,value}=chunk;if(done){state.ended=true;return bytes;}bytes+=value.length;
      if(bytes>limit)throw new Error('stream byte ceiling');
      await handle.writeFile(value);this.db.query('UPDATE files SET bytes=? WHERE id=?').run(bytes,id);
    }
  }
  private async preflight(obs:string,run:string){
    const robots=(body:Buffer,status:number)=>{if(status!==200 && status!==404) throw new Error('robots gate');if(status===200 && /^\s*(Disallow|Crawl-delay|Request-rate)\s*:\s*\S/im.test(body.toString()) && body.toString().trim()!=='User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: https://votetravis.gov/wp-sitemap.xml' && body.toString().trim()!=='User-agent: *\nDisallow: /wp-admin/') throw new Error('robots instructions require review');};
    await this.acquire(obs,run,'clarity-robots',HOST+'/robots.txt','text/plain',robots,true);
    await this.acquire(obs,run,'official-robots','https://votetravis.gov/robots.txt','text/plain',robots,true);
    await this.acquire(obs,run,'official-page',OFFICIAL,'text/html',(b,s)=>{if(s!==200 || !b.toString().includes(COUNTY)) throw new Error('official Clarity link changed/usage review required');},true);
  }
  private async listing(obs:string,run:string){
    const b=await this.acquire(obs,run,'catalog',COUNTY+'elections.json','application/json',(b,s)=>{if(s!==200)throw new Error('catalog HTTP');catalog(JSON.parse(b.toString()));});
    const entries=catalog(JSON.parse(b.toString()));
    const files=this.db.query<FileRow,[]>("SELECT * FROM files WHERE name='catalog' AND status='downloaded' ORDER BY rowid").all();
    for(const selection of entries){
      const e=await this.latestCatalogEntry(selection.EID,files);
      this.db.query('INSERT INTO elections VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,event_date=excluded.event_date,metadata=excluded.metadata').run(e.EID,'TX/Travis',e.ElectionName,e.Date,JSON.stringify(e));
    }
    return entries;
  }
  private async exclusive<T>(work:()=>Promise<T>):Promise<T>{if(this.active)throw new Error('one operation at a time');this.active=true;try{return await work();}finally{this.active=false;}}
  async list(){return this.exclusive(async()=>{const obs=crypto.randomUUID();this.db.query("INSERT INTO observations(id,status,started_at) VALUES(?,'catalog',?)").run(obs,this.stamp());const run=this.run(obs,'list');try{await this.preflight(obs,run);const entries=await this.listing(obs,run);this.finish(run,'succeeded');return entries;}catch(e){this.finish(run,'failed',e);throw e;}});}
  async collect(election:string,refresh=false){token(election);return this.collectSelected(election,undefined,refresh);}
  async collectDate(date:string,refresh=false){isoDate(date);return this.collectSelected(undefined,date,refresh);}
  private async retainedCatalog(){
    const row=this.db.query<FileRow,[]>("SELECT * FROM files WHERE name='catalog' AND status='downloaded' ORDER BY rowid DESC LIMIT 1").get();
    if(!row)return undefined;
    if(row.url!==COUNTY+'elections.json')throw new Error('catalog URL identity mismatch');
    return catalog(JSON.parse((await this.cached(row)).toString()));
  }
  private async collectSelected(election:string|undefined,date:string|undefined,refresh:boolean){
    return this.exclusive(async()=>{
      if(date && !refresh){const retained=await this.retainedCatalog();if(retained)election=selectDate(retained,date).EID;}
      if(!refresh){const reused=await this.reuseSelection(election,date);if(reused)return reused;}
      const {obs,id}=this.beginSelection(election,refresh);
      const run=this.run(id,'collect');
      try{
        const {x,coverage}=await this.collectCheckpoint(id,run,election,obs,date);
        this.saveSnapshot(id,x,coverage);
        this.finish(run,'succeeded');return {observation:id,coverage,reused:false};
      }catch(e){this.finish(run,'failed',e);throw e;}
    });
  }
  private async reuseSelection(election:string|undefined,date:string|undefined){
    const existing=this.db.query<Observation,[string]>("SELECT * FROM observations WHERE election=? AND status IN ('complete','disagreement') ORDER BY rowid DESC LIMIT 1").get(election??'');
    if(!existing)return undefined;
    await this.verify();const coverage=JSON.parse(existing.coverage!);
    if(date && sourceDate(coverage.sourceSettings.settings.electiondetails.electiondate)!==date)throw new Error('cached snapshot date differs; use --refresh');
    return {observation:existing.id,coverage,reused:true};
  }
  private beginSelection(election:string|undefined,refresh:boolean){
    const obs=refresh?null:this.db.query<Observation,[string]>("SELECT * FROM observations WHERE coalesce(election,(SELECT election FROM selections WHERE observation=observations.id))=? AND status='collecting' ORDER BY rowid DESC LIMIT 1").get(election??'');
    const id=obs?.id??crypto.randomUUID();
    if(!obs)this.db.query("INSERT INTO observations(id,status,started_at) VALUES(?,'collecting',?)").run(id,this.stamp());
    if(election)this.db.query('INSERT OR IGNORE INTO selections VALUES(?,?)').run(id,election);
    return {obs,id};
  }
  private async collectCheckpoint(id:string,run:string,election:string|undefined,obs:Observation|null,date?:string){
    await this.preflight(id,run);
    const entries=await this.listing(id,run),entry=date?selectDate(entries,date):entries.find(e=>e.EID===election);if(!entry)throw new Error('selection absent from current catalog');
    if(election && entry.EID!==election)throw new Error('catalog date selection changed; explicit refresh required');
    election=entry.EID;
    this.db.query('INSERT OR IGNORE INTO selections VALUES(?,?)').run(id,election);
    this.db.query('UPDATE observations SET election=? WHERE id=?').run(election,id);
    const before=await this.version(id,run,'version-before',election);
    if(obs?.version && obs.version!==before)throw new Error('checkpoint version changed; explicit refresh required');
    this.db.query('UPDATE observations SET version=? WHERE id=?').run(before,id);
    return this.snapshot(id,run,election,before,entry);
  }
  private saveSnapshot(id:string,x:ReturnType<typeof parseXml>,coverage:ReturnType<typeof coverageFor>){
    this.db.transaction(()=>{
      this.db.query('DELETE FROM result_rows WHERE observation=?').run(id);
      for(const r of x.rows)this.db.query('INSERT INTO result_rows VALUES(?,?,?,?,?,?)').run(id,r.contest,r.choice,r.voteType,r.precinct,r.votes);
      this.db.query('UPDATE observations SET status=?,coverage=? WHERE id=?').run(coverage.mismatches.length?'disagreement':'complete',JSON.stringify(coverage),id);
    }).immediate();
  }
  private async json(obs:string,run:string,name:string,url:string){return JSON.parse((await this.acquire(obs,run,name,url,'application/json',b=>{JSON.parse(b.toString());})).toString());}
  private async version(obs:string,run:string,name:string,election:string){return (await this.acquire(obs,run,name,COUNTY+election+'/current_ver.txt','text/plain',b=>{token(b.toString());},true)).toString();}
  private async snapshot(id:string,run:string,election:string,before:string,entry:ReturnType<typeof catalog>[number]){
    const prefix=COUNTY+election+'/'+before+'/';
    const config=await this.json(id,run,'config',prefix+'json/config.json');
    validateConfig(config);
    const settings=await this.json(id,run,'settings',prefix+'json/en/electionsettings.json');
    validateSettings(settings,election);
    const summary=await this.json(id,run,'summary',prefix+'json/en/summary.json'),status=await this.json(id,run,'status',prefix+'json/status.json'),details=await this.json(id,run,'details',prefix+'json/details.json');
    const zip=await this.acquire(id,run,'export',prefix+'reports/detailxml.zip','application/zip',b=>{parseXml(xmlFromZip(b));});
    const after=await this.version(id,run,'version-after',election);
    this.db.query('UPDATE observations SET after_version=? WHERE id=?').run(after,id);
    const x=parseXml(xmlFromZip(zip));
    validateXmlIdentity(x,entry,settings);
    return {x,coverage:coverageFor(x,summary,details,status,settings,before,after)};
  }
  async status(){return {observations:(this.db.query('SELECT count(*) n FROM observations').get() as {n:number}).n,files:(this.db.query("SELECT count(*) n FROM files WHERE status='downloaded'").get() as {n:number}).n,notBefore:this.cooldown(),runs:this.db.query('SELECT * FROM runs ORDER BY rowid DESC LIMIT 20').all(),coverage:this.db.query('SELECT id,election,version,after_version,status,coverage FROM observations ORDER BY rowid DESC LIMIT 20').all()};}
  async verify(){
    if((this.db.query('PRAGMA integrity_check').get() as {integrity_check:string}).integrity_check!=='ok' || this.db.query('PRAGMA foreign_key_check').all().length)throw new Error('SQLite integrity/foreign key failure');
    const files=this.db.query<FileRow,[]>("SELECT * FROM files WHERE status='downloaded' ORDER BY rowid").all();
    for(const f of files)await this.cached(f);
    const observations=this.db.query<Observation,[]>("SELECT * FROM observations WHERE coverage IS NOT NULL OR status IN ('complete','disagreement')").all();
    for(const obs of observations)await this.verifyObservation(obs,files);
    return {httpRequests:0,files:files.length,observations:observations.length,integrity:'ok'};
  }
  private async verifyObservation(obs:Observation,files:FileRow[]){
      token(obs.election);
      const routes=observationRoutes(obs.election,token(obs.version));
      const get=(name:string)=>this.observationFile(obs,files,routes,name);
      const json=async(name:string)=>JSON.parse((await get(name)).toString());
      const entries=catalog(await json('catalog')),entry=entries.find(e=>e.EID===obs.election);
      if(!entry)throw new Error('selection absent from retained catalog');
      await this.verifySource(obs,files);
      validateConfig(await json('config'));
      const settings=await json('settings');validateSettings(settings,obs.election);
      const x=parseXml(xmlFromZip(await get('export'))),before=token((await get('version-before')).toString()),after=token((await get('version-after')).toString());
      validateXmlIdentity(x,entry,settings);
      for(const name of ['clarity-robots','official-robots','official-page'])await get(name);
      const result=coverageFor(x,await json('summary'),await json('details'),await json('status'),settings,before,after);
      if(obs.version!==before || obs.after_version!==after || JSON.stringify(result)!==obs.coverage || obs.status!==(result.mismatches.length?'disagreement':'complete'))throw new Error('coverage/identity mismatch');
      this.verifyRows(obs.id,x.rows);
  }
  private async observationFile(obs:Observation,files:FileRow[],routes:ReturnType<typeof observationRoutes>,name:string){
      const matches=files.filter(f=>f.observation===obs.id && f.name===name),route=routes[name];
      if(!matches.length || !route)throw new Error('observation file missing');
      for(const f of matches){
        if(f.url!==route.url)throw new Error('observation URL identity mismatch');
        requireHttp(f.http_status,name,JSON.parse(f.headers)['content-type']??null,route.mime);
      }
      return this.cached(matches.at(-1)!);
  }
  private async latestCatalogEntry(election:string,files:FileRow[]){
      // The index follows its latest retained catalog; snapshot identity uses its own catalog.
      let entry:ReturnType<typeof catalog>[number]|undefined;
      for(const f of [...files].reverse().filter(f=>f.name==='catalog')){
        if(f.url!==COUNTY+'elections.json')throw new Error('catalog URL identity mismatch');
        entry=catalog(JSON.parse((await this.cached(f)).toString())).find(e=>e.EID===election);if(entry)break;
      }
      if(!entry)throw new Error('selection absent from retained catalogs');return entry;
  }
  private async verifySource(obs:Observation,files:FileRow[]){
      const entry=await this.latestCatalogEntry(obs.election,files);
      const source=this.db.query('SELECT * FROM sources WHERE id=?').get('TX/Travis');
      if(JSON.stringify(source)!==JSON.stringify({id:'TX/Travis',url:COUNTY,label:'Travis',state_id:'9',county_id:'1239'}))throw new Error('source identity mismatch');
      const election=this.db.query<any,[string]>('SELECT * FROM elections WHERE id=?').get(obs.election);
      const selection=this.db.query<any,[string]>('SELECT election FROM selections WHERE observation=?').get(obs.id);
      if(![election?.source==='TX/Travis',election?.label===entry.ElectionName,election?.event_date===entry.Date,JSON.stringify(JSON.parse(election?.metadata??'null'))===JSON.stringify(entry),selection?.election===obs.election].every(Boolean))throw new Error('catalog/selection identity mismatch');
  }
  private verifyRows(id:string,expected:ReturnType<typeof parseXml>['rows']){
      const rows=this.db.query('SELECT contest,choice,vote_type AS voteType,precinct,votes FROM result_rows WHERE observation=? ORDER BY contest,choice,vote_type,precinct').all(id);
      const order=(r:any)=>[r.contest,r.choice,r.voteType,r.precinct].join('/');if(JSON.stringify(rows)!==JSON.stringify([...expected].sort((a,b)=>order(a)<order(b)?-1:order(a)>order(b)?1:0)))throw new Error('stored row mismatch');
  }
}
function validateConfig(config:any){
  if(![config?.lang==='en',config?.isPublished===true,Number.isSafeInteger(config?.versionTemplate),config?.versionTemplate>0].every(Boolean))throw new Error('unsupported published English config schema; revalidate source adapter');
  if(config.languages!==undefined && (typeof config.languages!=='string' || !config.languages.split(',').some((v:string)=>v.startsWith('en|'))))throw new Error('English capability missing; revalidate source adapter');
}
function validateSettings(settings:any,election:string){
  const ed=settings?.settings?.electiondetails;
  if(![ed?.electionid===election,ed?.entityid==='1239',ed?.chkgeneratexml===true].every(Boolean))throw new Error('election identity/XML not advertised');
}
function validateXmlIdentity(x:ReturnType<typeof parseXml>,entry:ReturnType<typeof catalog>[number],settings:any){
  const ed=settings.settings.electiondetails;
  if(![x.region==='Travis',x.name===entry.ElectionName,x.name===ed.internalname,sourceDate(x.date)===sourceDate(ed.electiondate),sourceDate(x.date)===sourceDate(entry.Date)].every(Boolean))throw new Error('XML/catalog/settings identity mismatch');
}
function observationRoutes(election:string,version:string):Record<string,{url:string;mime:string}>{
  const prefix=COUNTY+election+'/'+version+'/';
  return {
    'clarity-robots':{url:HOST+'/robots.txt',mime:'text/plain'},
    'official-robots':{url:'https://votetravis.gov/robots.txt',mime:'text/plain'},
    'official-page':{url:OFFICIAL,mime:'text/html'},
    catalog:{url:COUNTY+'elections.json',mime:'application/json'},
    'version-before':{url:COUNTY+election+'/current_ver.txt',mime:'text/plain'},
    'version-after':{url:COUNTY+election+'/current_ver.txt',mime:'text/plain'},
    config:{url:prefix+'json/config.json',mime:'application/json'},
    settings:{url:prefix+'json/en/electionsettings.json',mime:'application/json'},
    summary:{url:prefix+'json/en/summary.json',mime:'application/json'},
    status:{url:prefix+'json/status.json',mime:'application/json'},
    details:{url:prefix+'json/details.json',mime:'application/json'},
    export:{url:prefix+'reports/detailxml.zip',mime:'application/zip'},
  };
}
async function releaseBody(reader:ReadableStreamDefaultReader<Uint8Array>,handle:{close:()=>Promise<void>}|undefined,ended:boolean){
  const errors:unknown[]=[];
  try{if(!ended)await reader.cancel();}catch(error){errors.push(error);}
  finally{try{reader.releaseLock();}catch(error){errors.push(error);}
    finally{try{await handle?.close();}catch(error){errors.push(error);}}}
  return errors;
}
function archivedFilename(path:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.body$/.test(path))throw new Error('unsafe archived filename');}
function declaredLength(headers:Headers,limit:number):string|null {
  const value=headers.get('content-length');if(value===null)return null;
  if(!/^[0-9]+$/.test(value) || Number(value)>limit)throw new Error('declared byte ceiling');return value;
}
function retryable(status:number|null,error:unknown){
  if(status!==null)return status===408 || status===429 || (status>=500 && status<=599);
  if(error instanceof DOMException)return error.name==='TimeoutError';
  return error instanceof TypeError;
}
function requireHttp(status:number,name:string,type:string|null,mime:string){
  if(name==='clarity-robots' && status===404)return;
  if(status!==200)throw new Error(`HTTP ${status}`);
  if(type?.split(';')[0]?.trim()!==mime)throw new Error('unexpected MIME');
}
function coverageFor(x:ReturnType<typeof parseXml>,summary:unknown,details:unknown,status:unknown,settings:unknown,before:string,after:string){
  let reconciled:ReturnType<typeof reconcile>;
  try{reconciled=reconcile(x,summary,details,status);}catch(error){throw new Error(`unsupported result schema; revalidate source adapter: ${String(error)}`);}
  const coverage={...reconciled,versionBefore:before,versionAfter:after,stable:before===after,scope:'one selected election/version; not historical completeness',xmlTimestamp:x.timestamp,sourceSettings:settings};
  if(before!==after)coverage.mismatches.push('version changed during observation');return coverage;
}
function retryAfterDelay(h:Headers,base:number):number {
  const raw=h.get('retry-after');if(!raw)return 0;
  const delay=/^[0-9]+(?:\.[0-9]+)?$/.test(raw)?Number(raw)*1000:Date.parse(raw)-base;
  if(!Number.isFinite(delay))throw new Error('ambiguous Retry-After');return delay;
}
function resetDelay(h:Headers,prefix:string,base:number):number {
  if(h.get(prefix+'ratelimit-remaining')?.trim()!=='0')return 0;
  const raw=h.get(prefix+'ratelimit-reset');if(!raw || !/^[0-9]+(?:\.[0-9]+)?$/.test(raw))throw new Error('ambiguous rate reset');
  return Number(raw)*1000-(prefix?base:0);
}
function structuredDelay(policy:string):number {
  if(!/(?:^|;)\s*r\s*=\s*0(?:;|$)/.test(policy))return 0;
  const match=/(?:^|;)\s*t\s*=\s*([0-9]+(?:\.[0-9]+)?)(?:;|$)/.exec(policy);if(!match)throw new Error('ambiguous structured rate reset');return Number(match[1])*1000;
}
export function serverDelay(h:Headers,now:number):number {
  const date=Date.parse(h.get('date')??''),base=Number.isFinite(date)?date:now;
  return Math.max(0,retryAfterDelay(h,base),resetDelay(h,'',base),resetDelay(h,'x-',base),...(h.get('ratelimit')??'').split(',').map(structuredDelay));
}
