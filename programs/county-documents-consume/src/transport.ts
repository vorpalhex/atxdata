import {PoliteHttpClient} from "../../civicclerk-consume/src/http";
import {Engine,sha} from "./engine";
import {officialUrl,sources,type Source} from "./adapters";
import {consumeEncoded,rawFetch} from "./encoding";
import {cooldown,robotsPolicy} from "./policy";
import {verifySchema,readCooldown} from "./schema";
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
 constructor(private readonly engine:Engine,dependencies:Partial<Dependencies>={}) {
  this.deps={fetch:rawFetch,now:Date.now,sleep:Bun.sleep,...dependencies};
  const fetch=async(url:string,init:RequestInit)=>{
   const original=await this.deps.fetch(url,init);
   const envelope=new Response(original.body,{status:200,headers:original.headers});
   this.statuses.set(envelope,original.status);
   return envelope;
  };
  this.http=new PoliteHttpClient({maxRetries:0,timeoutMs:90000,minIntervalMs:2000,userAgent:"atxdata-county-documents/0.1"},{...this.deps,fetch});
  verifySchema(engine.db);
 }
 private serial<T>(action:()=>Promise<T>):Promise<T> {
  const task=this.queue.then(action);
  this.queue=task.then(()=>{},()=>{});
  return task;
 }
 private gate():number {
  const row=readCooldown(this.engine.db);
  if(row.blocked) throw new Error(`transport stopped: ${row.blocked}`);
  return row.not_before;
 }
 private async wait():Promise<void> {
  while(this.gate()>this.deps.now()) await this.deps.sleep(Math.min(2147483647,this.gate()-this.deps.now()));
 }
 private budget(source:Source,kind:Kind):number {
  verifyTransportLedger(this.engine);
  const cap=kind==="pdf"?5*1024*1024:3*1024*1024;
  const totals=this.engine.db.query<{n:number;bytes:number},[]>("SELECT COUNT(*) n,COALESCE(SUM(CASE WHEN r.representation='legacy-decoded-only' THEN a.reservation ELSE COALESCE(a.bytes,a.reservation) END),0) bytes FROM attempts a LEFT JOIN representations r ON r.attempt=a.id").get()!;
  if(totals.n>=24 || totals.bytes+cap>20*1024*1024) throw new Error("durable request/byte budget exhausted");
  const count=this.engine.db.query<{n:number},[string,string]>("SELECT COUNT(*) n FROM attempts a JOIN runs r ON a.run=r.id WHERE r.source=? AND a.kind=?").get(source,kind)!.n;
  if(kind==="pdf" && count>=2) throw new Error("source PDF attempt limit");
  if(kind==="page" && count>=sources[source].pages.length) throw new Error("source discovery attempt limit");
  return cap;
 }
 private start(source:Source,url:string,kind:Kind):Attempt {
  // Recheck after the awaited pacing gate; another instance may have reserved the archive.
  this.gate();
  const cap=this.budget(source,kind),run=this.engine.start(source,kind),id=crypto.randomUUID();
  this.engine.db.transaction(()=>{
   this.engine.db.run("INSERT INTO attempts(id,run,url,kind,started,reservation) VALUES(?,?,?,?,?,?)",[id,run,url,kind,this.deps.now(),cap]);
   this.engine.db.run("UPDATE cooldowns SET blocked='unfinished attempt requires operator review' WHERE id=1");
  })();
  return {cap,run,id};
 }
 private headers(attempt:Attempt,response:Response):number {
  const status=this.statuses.get(response)??response.status;
  this.engine.db.run("UPDATE attempts SET status=?,headers=? WHERE id=?",[status,JSON.stringify([...response.headers]),attempt.id]);
  try {
   const end=cooldown(response.headers,this.deps.now());
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
  const wire=await this.engine.artifact(decoded.wire,"wire");
  const body=await this.engine.artifact(decoded.body,kind==="pdf"?"candidate":"html");
  this.engine.db.transaction(()=>{
   this.engine.db.run("INSERT INTO representations VALUES(?,?, 'encoded-and-decoded',?,?,?,?,?,?)",[attempt.id,decoded.encoding,decoded.wire.length,decoded.body.length,decoded.encodedHash,decoded.decodedHash,wire.path,body.path]);
   this.engine.db.run("UPDATE attempts SET bytes=?,sha=? WHERE id=?",[decoded.wire.length,decoded.encodedHash,attempt.id]);
  })();
  if(status!==200) throw new Error(`HTTP ${status}; no redirect/retry fanout`);
  if(kind!=="pdf" && /captcha|cf-chl-|access denied|verify you are human/i.test(decoded.body.toString())) throw new Error("source challenge/denial");
  return {body:decoded.body,mime:response.headers.get("content-type")??"",attempt:attempt.id,headers:JSON.stringify([...response.headers])};
 }
 private end(attempt:Attempt,delay:number,error?:unknown) {
  this.engine.db.run("UPDATE attempts SET ended=?,error=? WHERE id=?",[this.deps.now(),error?String(error):null,attempt.id]);
  this.engine.db.run("UPDATE cooldowns SET not_before=MAX(not_before,?) WHERE id=1",[this.deps.now()+Math.max(2000,delay)]);
  if(!error) this.engine.db.run("UPDATE cooldowns SET blocked=NULL WHERE id=1");
  this.engine.finish(attempt.run,error);
 }
 private async request(source:Source,url:string,kind:Kind,delay:number) {
  officialUrl(source,url,sources[source].pages[0]);
  verifyTransportLedger(this.engine);
  await this.wait();
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
  return robotsPolicy(row.body,parsed.pathname+parsed.search);
 }
 async resolveDecodedRobots(id:string,reason:string) {
  const row=this.engine.db.query<{url:string;status:number;kind:string;sha:string;bytes:number;headers:string;error:string;ended:number},[string]>("SELECT * FROM attempts WHERE id=?").get(id);
  if(!row || !reason.trim()) throw new Error("missing classifier resolution evidence");
  const headers=new Headers(JSON.parse(row.headers));
  this.requireLegacyRobots(row,headers);
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
 discover(source:Source,url:string) {
  return this.serial(async()=>{
   if(!(sources[source].pages as readonly string[]).includes(url)) throw new Error("unapproved discovery URL");
   const delay=await this.robots(source,url);
   const result=await this.request(source,url,"page",delay);
   if(!/^text\/html(?:;|$)/i.test(result.mime)) throw new Error("HTML MIME mismatch");
   return this.engine.importPage(source,url,result.body.toString(),"live-http",result.headers);
  });
 }
 collect(id:string) {
  return this.serial(async()=>{
   const row=this.engine.observation(id);
   const delay=await this.robots(row.source,row.url);
   const result=await this.request(row.source,row.url,"pdf",delay);
   return this.engine.importPdf(id,result.body,result.mime,"live-http",result.headers);
  });
 }
}
