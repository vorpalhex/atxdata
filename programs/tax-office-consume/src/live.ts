import {open,readFile} from 'node:fs/promises';import {join} from 'node:path';
import {PoliteHttpClient} from '../../civicclerk-consume/src/http';
import {promote} from '../../civicclerk-consume/src/archive';
import {Collector} from './collector';import {CAPS,ROUTES,HOST,parseCsv,validatePdf} from './source';
type Kind=keyof typeof ROUTES;
function retryDelay(h:Headers,base:number){
 const raw=h.get('retry-after');if(!raw)return 0;
 const ms=/^\d+(?:\.\d+)?$/.test(raw.trim())?Number(raw)*1000:Date.parse(raw)-base;
 if(!Number.isFinite(ms))throw new Error('ambiguous Retry-After');return ms;
}
function validReset(remaining:string|null,reset:string|null){
 if(remaining!==null&&!/^\d+$/.test(remaining.trim()))throw new Error('ambiguous remaining');
 if(reset!==null&&remaining===null)throw new Error('ambiguous reset without remaining');
}
function resetDelay(h:Headers,prefix:string,base:number){
 const remaining=h.get(prefix+'ratelimit-remaining'),reset=h.get(prefix+'ratelimit-reset');
 validReset(remaining,reset);
 if(remaining?.trim()!=='0')return 0;
 if(reset===null||!/^\d+(?:\.\d+)?$/.test(reset.trim()))throw new Error('ambiguous reset');
 return Number(reset)*1000-(prefix?base:0);
}
function policyDelay(policy:string){
 const params=policy.split(';').slice(1).map(s=>s.trim()),seen=new Map<string,string>();
 for(const param of params){const m=/^(r|t)\s*=\s*(\d+(?:\.\d+)?)$/.exec(param);if(!m||seen.has(m[1]!))throw new Error('ambiguous structured policy');seen.set(m[1]!,m[2]!);}
 if(!seen.has('r'))throw new Error('ambiguous structured remaining');
 if(Number(seen.get('r'))!==0)return 0;if(!seen.has('t'))throw new Error('ambiguous structured reset');return Number(seen.get('t'))*1000;
}
function knownPolicy(h:Headers){
 for(const name of h.keys())if(/rate-?limit/i.test(name)&&!['ratelimit','ratelimit-limit','ratelimit-policy','ratelimit-remaining','ratelimit-reset','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset'].includes(name))throw new Error('ambiguous unknown rate policy');
 if(h.has('ratelimit-policy'))throw new Error('ambiguous policy requires review');
}
export function serverDelay(h:Headers,now:number){
 knownPolicy(h);const date=Date.parse(h.get('date')??''),base=Number.isFinite(date)?date:now;
 const policies=h.has('ratelimit')?h.get('ratelimit')!.split(',').map(policyDelay):[0];
 const delay=Math.max(0,retryDelay(h,base),resetDelay(h,'',base),resetDelay(h,'x-',base),resetDelay(h,'x-',now),...policies);
 if(!Number.isSafeInteger(Math.ceil(delay))||delay>Number.MAX_SAFE_INTEGER-now)throw new Error('ambiguous cooldown overflow');return delay;
}

function defer(c:Collector,until:number){c.db.query('UPDATE cooldown SET not_before=max(not_before,?) WHERE id=1').run(until);}
async function wait(c:Collector){let until=c.status().cooldown;if(until===Number.MAX_SAFE_INTEGER)throw new Error('ambiguous policy requires operator review');while(until>c.deps.now())await c.deps.sleep(Math.min(2147483647,until-c.deps.now()));}
function setup(c:Collector){c.db.exec(`CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,run TEXT NOT NULL REFERENCES runs(id),kind TEXT NOT NULL,url TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,bytes INTEGER NOT NULL,http_status INTEGER,headers TEXT,started_at TEXT NOT NULL,finished_at TEXT,error TEXT)`);}
function declared(response:Response,cap:number){
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>cap))throw new Error('declared byte ceiling');
 if(response.headers.get('content-encoding')&&!/^identity$/i.test(response.headers.get('content-encoding')!))throw new Error('unsupported encoding');return length;
}
type BodyReader=Pick<ReadableStreamDefaultReader<Uint8Array>,'cancel'|'releaseLock'>;
export async function releaseBody(reader:BodyReader,handle:{close:()=>Promise<void>}|undefined,ended:boolean):Promise<unknown[]>{
 const errors:unknown[]=[];
 try{if(!ended)await reader.cancel();}catch(error){errors.push(error);}
 finally{
  try{reader.releaseLock();}catch(error){errors.push(error);}
  finally{try{await handle?.close();}catch(error){errors.push(error);}}
 }
 return errors;
}
async function writeChunks(reader:ReadableStreamDefaultReader<Uint8Array>,handle:Awaited<ReturnType<typeof open>>,cap:number,state:{ended:boolean}){
 let bytes=0;
 for(;;){
  let chunk:Awaited<ReturnType<typeof reader.read>>;
  try{chunk=await reader.read();}catch(error){state.ended=true;throw error;}
  if(chunk.done){state.ended=true;return bytes;}
  bytes+=chunk.value.length;if(bytes>cap)throw new Error('stream byte ceiling');await handle.writeFile(chunk.value);
 }
}
function cleanupFailure(failure:{error:unknown}|undefined,errors:unknown[]){
 const causes=failure?[failure.error,...errors]:errors;
 return new AggregateError(causes,causes.map(String).join('; cleanup: '),{cause:failure?.error});
}
export async function streamBody(response:Response,path:string,cap:number){
 if(!response.body)throw new Error('missing response body');
 // Acquire before any filesystem await: native EOF before getReader breaks Bun lock bookkeeping.
 const reader=response.body.getReader(),state={ended:false};let handle:Awaited<ReturnType<typeof open>>|undefined,failure:{error:unknown}|undefined;
 try{handle=await open(path+'.pending','wx',0o600);const bytes=await writeChunks(reader,handle,cap,state);await handle.sync();return bytes;}
 catch(error){failure={error};throw error;}
 finally{const errors=await releaseBody(reader,handle,state.ended);if(errors.length)throw cleanupFailure(failure,errors);}
}
async function consume(c:Collector,response:Response,path:string,cap:number){
 const length=declared(response,cap),bytes=await streamBody(response,path,cap);
 if(length!==null&&Number(length)!==bytes)throw new Error('content length mismatch');
 await promote(path);return readFile(path);
}
export function robotsRedirect(url:string,headers:Headers){
 const location=headers.get('location');if(!location||url!==ROUTES.robots)throw new Error('robots redirect requires review');
 const target=new URL(location,ROUTES.robots);
 if(target.href!==HOST+'/404')throw new Error('robots redirect outside HTTPS allowlist');return target.href;
}
function missingRobots(text:string,response:Response,url:string){
 if(!text.trim())return response.status===404;
 if(!/<(?:!doctype|html|title|body)\b/i.test(text))return response.status===404&&/^(?:404\s*)?(?:not found|page not found)\s*$/i.test(text.trim());
 const marker=/<title[^>]*>[^<]*(?:404|not found)[^<]*<\/title>/i.test(text)&&/page (?:was )?not found|404\s*(?:error|not found)|the page you are looking for doesn['’]t seem to exist/i.test(text);
 return marker&&(response.status===404||(url===HOST+'/404'&&response.status===200));
}
function validateRobots(body:Buffer,response:Response,url:string){
 if(![200,302,404].includes(response.status))throw new Error(`HTTP ${response.status}`);
 const text=body.toString();
 if(/captcha|access denied|sign[ -]?in|log[ -]?in|challenge|cloudflare/i.test(text))throw new Error('robots access gate');
 if(response.status===302){robotsRedirect(url,response.headers);return;}
 if(response.status===404||url!==ROUTES.robots){if(!missingRobots(text,response,url))throw new Error('robots missing-page response requires review');return;}
 if(/<(?:!doctype|html|title|body)\b/i.test(text))throw new Error('robots unexpected HTML');
 if(/^\s*(?:Disallow|Crawl-delay|Request-rate)\s*:\s*\S/im.test(text))throw new Error('robots instructions require review');
 validateRobotsLines(text);
}
function validateRobotsLines(text:string){
 const lines=text.split(/\r?\n/).map(line=>line.replace(/#.*$/,'').trim()).filter(Boolean);
 if(lines.some(line=>! /^(?:user-agent|allow|disallow|sitemap)\s*:/i.test(line)))throw new Error('robots unrecognized instructions');
}
function validatePolicy(kind:Kind,body:Buffer,response:Response){
 const text=body.toString();
 if(kind==='discovery'&&(!text.includes('/voterdata/TaxDelqOpenData.csv')||!text.includes('DelinquentFileLayout.php')||/captcha|access denied|sign in/i.test(text)))throw new Error('discovery gate/usage review');
}

function validate(kind:Kind,body:Buffer,response:Response,maxRows:number,url:string){
 if(kind==='robots'){validateRobots(body,response,url);return;}
 if(response.status!==200)throw new Error(`HTTP ${response.status}`);
 validatePolicy(kind,body,response);
 if(kind==='csv')parseCsv(body,maxRows);if(kind==='layout')validatePdf(body);
}
async function transfer(c:Collector,http:PoliteHttpClient,id:string,path:string,kind:Kind,cap:number,maxRows:number,url:string){
 return http.request(url,async response=>{
   const status=response.status;c.db.query("UPDATE attempts SET status='receiving',http_status=?,headers=? WHERE id=?").run(status,JSON.stringify(Object.fromEntries(response.headers)),id);
   try{defer(c,c.deps.now()+serverDelay(response.headers,c.deps.now()));}catch(e){defer(c,Number.MAX_SAFE_INTEGER);throw e;}
   const raw=await consume(c,response,join(c.root,path),cap);validate(kind,raw,response,maxRows,url);
   c.db.query("UPDATE attempts SET status='validated',bytes=?,finished_at=? WHERE id=?").run(raw.length,c.stamp(),id);return {raw,headers:response.headers,status};
  });
}
export function retryable(status:number|null,e:unknown){
 if(status!==null&&status!==200)return [408,409,425,429].includes(status)||(status>=500&&status<=599);
 const primary=e instanceof AggregateError?e.errors[0]:e;
 return primary instanceof TypeError||(primary instanceof DOMException&&primary.name==='TimeoutError');
}
function budget(c:Collector,run:string,kind:Kind){
 const used=c.db.query('SELECT count(*) n,coalesce(sum(bytes),0) bytes FROM attempts WHERE run=?').get(run) as {n:number;bytes:number};
 const cap=CAPS[kind];if(used.n>=CAPS.requests||used.bytes+cap>CAPS.total)throw new Error('run attempt/byte ceiling');return cap;
}
function allowance(c:Collector,run:string,kind:Kind,previous:{error:unknown}|undefined){
 try{return budget(c,run,kind);}catch(error){
  if(!previous)throw error;
  throw new Error(`${String(error)}; previous transfer failed: ${String(previous.error)}`,{cause:previous.error});
 }
}
function errorReceipt(error:unknown,seen=new Set<unknown>()):string{
 if(!(error instanceof Error))return String(error);
 const identity=`${error.name}: ${error.message}`;
 if(seen.has(error))return identity;
 seen.add(error);
 const details=[identity,error.stack??''];
 if(error instanceof AggregateError)details.push(...error.errors.map(item=>errorReceipt(item,seen)));
 if(error.cause!==undefined)details.push(errorReceipt(error.cause,seen));
 return details.join('\nCleanup/primary: ');
}
async function acquire(c:Collector,http:PoliteHttpClient,run:string,kind:Kind,maxRows:number,url:string=ROUTES[kind]){
 let previous:{error:unknown}|undefined;
 for(let n=0;n<4;n++){
  const cap=allowance(c,run,kind,previous);await wait(c);
  const id=crypto.randomUUID(),path=id+'.attempt';
  // Durable conservative reservation: a killed process never forgets bytes.
  c.db.query("INSERT INTO attempts VALUES(?,?,?,?,?,'requesting',?,NULL,NULL,?,NULL,NULL)").run(id,run,kind,url,path,cap,c.stamp());
  try{return await transfer(c,http,id,path,kind,cap,maxRows,url);}catch(e){
   previous={error:e};c.db.query("UPDATE attempts SET status='failed',finished_at=?,error=? WHERE id=?").run(c.stamp(),errorReceipt(e),id);
   const {http_status:status}=c.db.query<{http_status:number|null},[string]>('SELECT http_status FROM attempts WHERE id=?').get(id)!;
   if(!retryable(status,e)||n===3)throw e;defer(c,c.deps.now()+Math.max(2000,500*2**n+c.deps.random()*250));
  }finally{defer(c,c.deps.now()+2000);}
 }
 throw new Error('attempt ceiling');
}
function selectionBound(selection:string,maxRows:number){if(selection!=='delinquency'||!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>CAPS.rows)throw new Error('explicit delinquency and row bound required');}
export async function collect(c:Collector,selection:string,maxRows:number,refresh:boolean){
 return c.exclusive(async()=>{
  selectionBound(selection,maxRows);
  if(!refresh){const s=c.db.query<{id:string;row_count:number},[]>('SELECT id,row_count FROM snapshots WHERE status=\'complete\' ORDER BY rowid DESC LIMIT 1').get();if(s){if(s.row_count>maxRows)throw new Error('row ceiling');await c.verify();return {snapshot:s.id,rows:s.row_count,reused:true};}}
  setup(c);const {id,run}=c.start(selection,maxRows,'live',refresh);
  const statuses=new WeakMap<Response,number>();
  const http=new PoliteHttpClient({maxRetries:0,minIntervalMs:2000,timeoutMs:60000,userAgent:'atxdata-tax-office/0.1'},{...c.deps,fetch:async(url,init)=>{
   const original=await c.deps.fetch(url,{...init,credentials:'omit',referrerPolicy:'no-referrer'});const envelope=new Response(original.body,{status:200,headers:original.headers});statuses.set(envelope,original.status);return envelope;
  }});
  // An envelope allows retaining real error bodies without changing shared HTTP.
  const request=http.request.bind(http);http.request=(url,fn)=>request(url,r=>fn(new Response(r.body,{status:statuses.get(r)??200,headers:r.headers})));
  try{
   const robots=await acquire(c,http,run,'robots',maxRows);
   if(robots.status===302)await acquire(c,http,run,'robots',maxRows,robotsRedirect(ROUTES.robots,robots.headers));
   await acquire(c,http,run,'discovery',maxRows);
   for(const kind of ['csv','layout'] as const){const a=await acquire(c,http,run,kind,maxRows);await c.retain(id,run,kind,a.raw,{headers:a.headers,status:a.status});}
   return await c.checkpoint(id,run,maxRows);
  }catch(e){c.finish(run,'failed',e);throw e;}
 });
}
