import {load} from 'cheerio';
import {archiveForm,requireArchiveEndpoint} from './historical';
import {humanScope,humanOption,robotsDecision,type HumanAcknowledgement} from './human-policy';
import {OperationBudget,type WorkBudget} from "./budgets";
import {PoliteHttpClient} from "../../civicclerk-consume/src/http";
import {Engine,sha} from "./engine";
import {transportUrl,sources,type Source} from "./adapters";
import {consumeEncoded,rawFetch} from "./encoding";
import {cooldown,robotsPolicy} from "./policy";
import {verifySchema,readCooldown} from "./schema";
import {verifyRepresentations} from './archive-verification';
import {verifyTransportLedger} from "./transport-integrity";
export {cooldown} from "./policy";

type Dependencies={fetch:(url:string,init:RequestInit)=>Promise<Response>;now:()=>number;sleep:(ms:number)=>Promise<void>};
type Kind="robots"|"page"|"pdf";
type Attempt={id:string;run:string;cap:number};

export class Transport {
 private readonly deps:Dependencies;
 private readonly http:PoliteHttpClient;
 private readonly statuses=new WeakMap<Response,number>();
 private queue=Promise.resolve();
 private readonly operation:OperationBudget;
 private readonly human:boolean;
 private acknowledgement:HumanAcknowledgement|undefined;
 private postBody:string|undefined;
 private anonymous=false;
 private readonly cookies=new Map<string,string>();
 constructor(private readonly engine:Engine,dependencies:Partial<Dependencies>={},budget:Partial<WorkBudget>={},options:{human?:boolean}={}) {
  this.human=humanOption(options.human);
  this.operation=new OperationBudget({maxPdfBytes:engine.maxPdfBytes,...budget});
  if(this.operation.limits.maxPdfBytes>engine.maxPdfBytes) throw Error('transport PDF budget exceeds engine PDF budget');
  this.deps={fetch:rawFetch,now:Date.now,sleep:Bun.sleep,...dependencies};
  const fetch=(url:string,init:RequestInit)=>this.fetchEnvelope(url,init);
  this.http=new PoliteHttpClient({maxRetries:0,timeoutMs:90000,minIntervalMs:3000,userAgent:"atxdata-county-documents/0.1"},{...this.deps,fetch});
  verifySchema(engine.db);
 }
 private anonymousInit(url:string,init:RequestInit):RequestInit {
   const headers=new Headers(init.headers);
   if(this.anonymous && humanScope(url)) {
    if(this.cookies.size) headers.set('Cookie',[...this.cookies.values()].join('; '));
    if(this.postBody!==undefined) headers.set('Content-Type','application/x-www-form-urlencoded');
   }
   return {...init,headers,...(this.postBody===undefined?{}:{method:'POST',body:this.postBody})};
 }
 private async fetchEnvelope(url:string,init:RequestInit):Promise<Response> {
   const original=await this.deps.fetch(url,this.anonymousInit(url,init));
   if(this.anonymous && humanScope(url)) for(const cookie of original.headers.getSetCookie()) {
    const pair=cookie.split(';')[0]!;
    if(/^[A-Za-z0-9_-]+=[^;\r\n]*$/.test(pair) && !/;\s*domain=/i.test(cookie)) this.cookies.set(pair.split('=')[0]!,pair);
   }
   const envelope=new Response(original.body,{status:200,headers:original.headers});
   this.statuses.set(envelope,original.status);
   return envelope;
 }
 private serial<T>(action:()=>Promise<T>):Promise<T> {
  const task=this.queue.then(action);
  this.queue=task.then(()=>{},()=>{});
  return task;
 }
 private gate():number {
  verifyTransportLedger(this.engine);
  const row=readCooldown(this.engine.db);
  if(row.blocked) throw new Error(`transport stopped: ${row.blocked}`);
  return row.not_before;
 }
 private async wait():Promise<void> {
  while(this.gate()>this.deps.now()) await this.deps.sleep(Math.min(2147483647,this.gate()-this.deps.now()));
 }
 private budget(source:Source,kind:Kind):number {
  verifyTransportLedger(this.engine);
  return this.operation.reserve(kind);
 }
 private start(source:Source,url:string,kind:Kind):Attempt {
  // Recheck after the awaited pacing gate; another instance may have reserved the archive.
  this.gate();
  const cap=this.budget(source,kind),run=this.engine.start(source,this.operation.receipt(kind,cap,kind==='robots'?undefined:this.acknowledgement),'transport-work-v2:'+crypto.randomUUID()),id=crypto.randomUUID();
  this.engine.db.transaction(()=>{
   this.engine.db.run("INSERT INTO attempts(id,run,url,kind,started,reservation) VALUES(?,?,?,?,?,?)",[id,run,url,kind,this.deps.now(),cap]);
   this.engine.db.run("UPDATE cooldowns SET blocked='unfinished attempt requires operator review' WHERE id=1");
  })();
  return {cap,run,id};
 }
 private headers(attempt:Attempt,response:Response):number {
  const status=this.statuses.get(response)??response.status;
  const observed=this.deps.now();
  const row=this.engine.db.query<{kind:string},[string]>("SELECT kind FROM runs WHERE id=?").get(attempt.run)!;
  const receipt=JSON.parse(row.kind.slice("transport-work-v1:".length));
  receipt.headerTiming={clockBasis:"unix-ms",observed};
  this.engine.db.run("UPDATE runs SET kind=? WHERE id=?",["transport-work-v1:"+JSON.stringify(receipt),attempt.run]);
  this.engine.db.run("UPDATE attempts SET status=?,headers=? WHERE id=?",[status,JSON.stringify([...response.headers]),attempt.id]);
  try {
   const end=cooldown(response.headers,observed);
   this.engine.db.run("UPDATE cooldowns SET not_before=MAX(not_before,?) WHERE id=1",[end]);
  } catch(error) {
   this.engine.db.run("UPDATE cooldowns SET blocked=? WHERE id=1",[String(error)]);
   throw error;
  }
  return status;
 }
 private async consume(attempt:Attempt,response:Response,kind:Kind) {
  const status=this.headers(attempt,response);
  const decoded=await consumeEncoded(response,attempt.cap);
  this.operation.complete(attempt.cap,decoded.wire.length);
  const wire=await this.engine.artifact(decoded.wire,"wire");
  const body=await this.engine.artifact(decoded.body,kind==="pdf"?"candidate":"html");
  this.engine.db.transaction(()=>{
   this.engine.db.run("INSERT INTO representations VALUES(?,?, 'encoded-and-decoded',?,?,?,?,?,?)",[attempt.id,decoded.encoding,decoded.wire.length,decoded.body.length,decoded.encodedHash,decoded.decodedHash,wire.path,body.path]);
   this.engine.db.run("UPDATE attempts SET bytes=?,sha=? WHERE id=?",[decoded.wire.length,decoded.encodedHash,attempt.id]);
  })();
  if(status!==200) throw new Error(`HTTP ${status}; no redirect/retry fanout`);
  if((kind!=="pdf" || !/^application\/pdf(?:;|$)/i.test(response.headers.get("content-type")??"")) && /captcha|cf-chl-|access denied|verify you are human/i.test(decoded.body.toString())) throw new Error("source challenge/denial");
  return {body:decoded.body,mime:response.headers.get("content-type")??"",attempt:attempt.id,headers:JSON.stringify([...response.headers])};
 }
 private end(attempt:Attempt,delay:number,error?:unknown) {
  this.engine.db.run("UPDATE attempts SET ended=?,error=? WHERE id=?",[this.deps.now(),error?String(error):null,attempt.id]);
  this.engine.db.run("UPDATE cooldowns SET not_before=MAX(not_before,?) WHERE id=1",[this.deps.now()+Math.max(3000,delay)]);
  if(!error) this.engine.db.run("UPDATE cooldowns SET blocked=NULL WHERE id=1");
  this.engine.finish(attempt.run,error);
 }
 private async request(source:Source,url:string,kind:Kind,delay:number) {
  transportUrl(source,url,kind);
  await this.engine.preflight();
  await this.wait();
  await this.engine.preflight();
  const attempt=this.start(source,url,kind);
  try {
   const result=await this.http.request(url,response=>this.consume(attempt,response,kind));
   this.end(attempt,delay);
   return result;
  } catch(error) {
   this.end(attempt,delay,error);
   throw error;
  }
 }
 private saveRobots(origin:string,body:string,observed:number):number {
  const delay=robotsPolicy(body,"/robots.txt");
  this.engine.db.run("INSERT INTO robots VALUES(?,?,?,?,?)",[origin,body,sha(body),delay,observed]);
  this.engine.db.run("UPDATE cooldowns SET not_before=MAX(not_before,?) WHERE id=1",[observed+delay]);
  return delay;
 }
 private async robots(source:Source,url:string):Promise<number> {
  const parsed=new URL(url),origin=parsed.origin;
  let row=this.engine.db.query<{body:string;sha:string},[string]>("SELECT * FROM robots WHERE origin=?").get(origin);
  if(!row) {
   const result=await this.request(source,origin+"/robots.txt","robots",2000);
   if(!/^text\/plain(?:;|$)/i.test(result.mime)) throw new Error("robots MIME unresolved");
   this.saveRobots(origin,result.body.toString(),this.deps.now());
   row={body:result.body.toString(),sha:sha(result.body)};
  }
  if(sha(row.body)!==row.sha) throw new Error("robots provenance corrupted");
  const decision=robotsDecision(row.body,row.sha,url,this.human);
  this.acknowledgement=decision.acknowledgement;
  return decision.delay;
 }
 async resolveDecodedRobots(id:string,reason:string) {
  await this.engine.archiveIntegrity();
  const row=this.engine.db.query<{url:string;status:number;kind:string;sha:string;bytes:number;headers:string;error:string;ended:number},[string]>("SELECT * FROM attempts WHERE id=?").get(id);
  if(!row || !reason.trim()) throw new Error("missing classifier resolution evidence");
  const headers=new Headers(JSON.parse(row.headers));
  this.requireLegacyRobots(row,headers);
  await verifyRepresentations(this.engine,id);
  const body=await this.engine.readArtifact(`${row.sha}.html`);
  if(sha(body)!==row.sha || body.length!==row.bytes) throw new Error("retained decoded robots mismatch");
  const gate=readCooldown(this.engine.db);
  if(!gate.blocked) throw new Error("no failed gate to resolve");
  robotsPolicy(body.toString(),"/robots.txt");
  this.engine.db.transaction(()=>{
   this.engine.db.run("INSERT INTO classifier_resolutions VALUES(?,?,?,?,?)",[id,this.deps.now(),gate.blocked,reason,row.sha]);
   this.engine.db.run("INSERT INTO representations VALUES(?,?, 'legacy-decoded-only',NULL,?,NULL,?,NULL,?)",[id,headers.get("content-encoding")!,body.length,row.sha,`${row.sha}.html`]);
   this.saveRobots(new URL(row.url).origin,body.toString(),row.ended);
   this.engine.db.run("UPDATE cooldowns SET blocked=NULL WHERE id=1");
  })();
  return {resolved:id,representation:"legacy-decoded-only",wireBytes:null,wireHash:null,decodedHash:row.sha};
 }
 private requireLegacyRobots(row:{url:string;status:number;kind:string;error:string;bytes:number},headers:Headers) {
  const checks=[row.kind==="robots",row.status===200,new URL(row.url).pathname==="/robots.txt",row.error==="Error: Content-Length mismatch",headers.get("content-type")?.startsWith("text/plain"),["br","gzip"].includes(headers.get("content-encoding")??""),row.bytes<=3*1024*1024];
  if(!checks.every(Boolean)) throw new Error("not the retained decoded-response classifier failure");
 }
 private async archiveEndpoint(sourceHref:string,endpoint:string):Promise<void> {
  requireArchiveEndpoint(sourceHref,endpoint);
  const snapshots=this.engine.db.query<{path:string},[string]>("SELECT path FROM snapshots WHERE source='county-code' AND url=?").all(sources['county-code'].pages[0]);
  for(const snapshot of snapshots) {
   const $=load((await this.engine.readArtifact(snapshot.path)).toString());
   if($('a[href]').toArray().some(e=>$(e).attr('href')===sourceHref)) return;
  }
  throw Error('archive endpoint lacks retained official source href');
 }
 private async archivePage(url:string,body?:string) {
  const delay=await this.robots('county-code',url);
  this.postBody=body;
  try {
   const result=await this.request('county-code',url,'page',delay);
   if(!/^text\/html(?:;|$)/i.test(result.mime)) throw Error('HTML MIME mismatch');
   return {...result,url,html:result.body.toString()};
  }finally {this.postBody=undefined;}
 }
 archive(sourceHref:string,endpoint:string,value?:string) {
  return this.serial(async()=>{
   await this.engine.preflight();
   await this.archiveEndpoint(sourceHref,endpoint);
   this.anonymous=true;this.cookies.clear();
   const initial=await this.archivePage(endpoint),form=archiveForm(initial.html,endpoint,value);
   if(value===undefined) return {sourceHref,endpoint,options:form.options,aliases:[] as string[],attempts:[initial.attempt]};
   const applied=await this.archivePage(form.action,form.body);
   const readback=await this.archivePage(endpoint),selected=archiveForm(readback.html,endpoint).options.filter(o=>o.selected);
   if(!selected.length || selected.some(o=>o.value!==value)) throw Error('archive server-selected readback mismatch');
   return {sourceHref,endpoint,options:form.options,aliases:selected.map(o=>o.label),attempts:[initial.attempt,applied.attempt,readback.attempt]};
  });
 }
 discover(source:Source,url:string) {
  return this.serial(async()=>{
   await this.engine.preflight();
   await this.engine.requireDiscoveryPage(source,url);
   const delay=await this.robots(source,url);
   const result=await this.request(source,url,"page",delay);
   if(!/^text\/html(?:;|$)/i.test(result.mime)) throw new Error("HTML MIME mismatch");
   return this.engine.importPage(source,url,result.body.toString(),"live-http",result.headers);
  });
 }
 async discoverTree(source:Source,url:string) {
  const pending=[url],visited=new Set<string>(),snapshots=[];
  while(pending.length && visited.size<this.operation.limits.maxPages) {
   const next=pending.shift()!;
   if(visited.has(next)) continue;
   snapshots.push(await this.discover(source,next));visited.add(next);
   for(const link of await this.engine.discoveryPages(source)) {
    const retained=this.engine.db.query('SELECT 1 FROM snapshots WHERE source=? AND url=? LIMIT 1').get(source,link.url);
    if(!retained && !visited.has(link.url) && !pending.includes(link.url)) pending.push(link.url);
   }
  }
  return {snapshots,complete:pending.length===0,pending};
 }
 collect(id:string) {
  return this.serial(async()=>{
   await this.engine.preflight();
   const row=this.engine.observation(id);
   const delay=await this.robots(row.source,row.url);
   const result=await this.request(row.source,row.url,"pdf",delay);
   return this.engine.importPdf(id,result.body,result.mime,"live-http",result.headers);
  });
 }
}
