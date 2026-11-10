import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {Engine} from '../src/engine';
import {Transport} from '../src/transport';
import {sources} from '../src/adapters';

const html='<h2>FY 2032</h2><a href="/reviewer-tax.pdf">Taxpayer Impact Statement</a>';
function logical(db:Database) {
 return Object.fromEntries(db.query<{name:string},[]>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.query(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}
async function fixture() {
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'policy-boundary-'))),e=await Engine.open(root);
 let now=1700000000000,calls=0;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  calls++;const robots=url.endsWith('/robots.txt');
  return new Response(robots?'User-agent: *\nCrawl-delay: 7\nDisallow:':html,{headers:{'content-type':robots?'text/plain':'text/html',...(robots?{}:{'retry-after':'91'})}});
 }};
 await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);await e.preflight();
 return {root,e,calls:()=>calls};
}
for(const entrypoint of ['import','preflight'] as const) for(const fault of [false,true]) test(`F6-A final awaited representation read ${entrypoint} control/fault=${fault}`,async()=>{
 const {e,root,calls}=await fixture(),original=e.readArtifact.bind(e);
 const last=e.db.query<{wire_path:string},[]>("SELECT wire_path FROM representations ORDER BY rowid DESC LIMIT 1").get()!.wire_path;
 let armed=true,before:ReturnType<typeof logical>|undefined;
 try {
  e.readArtifact=async(path:string)=>{
   const bytes=await original(path);
   if(armed && path===last && new Error().stack?.includes('verifyWire')) {
    armed=false;if(fault)e.db.run('UPDATE cooldowns SET not_before=0');before=logical(e.db);
   }
   return bytes;
  };
  const operation=entrypoint==='import'?e.importPage('budgets',sources.budgets.pages[0],html,'authored-offline'):e.preflight();
  if(fault) await expect(operation).rejects.toThrow(/cooldown/);else await operation;
  expect(armed).toBe(false);expect(before).toBeDefined();expect(calls()).toBe(2);
  if(fault) {expect(logical(e.db)).toEqual(before!);expect(e.db.query<{not_before:number},[]>('SELECT not_before FROM cooldowns').get()!.not_before).toBe(0);}
  else {if(entrypoint==='import')expect(logical(e.db)).not.toEqual(before!);else expect(logical(e.db)).toEqual(before!);await e.preflight();}
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
for(const stage of ['discovery','artifact','reuse'] as const) for(const fault of [false,true]) test(`F6-A later awaited ${stage} control/fault=${fault}`,async()=>{
 const {e,root,calls}=await fixture();let armed=true,before:ReturnType<typeof logical>|undefined;
 const inject=()=>{if(armed){armed=false;if(fault)e.db.run('UPDATE cooldowns SET not_before=0');before=logical(e.db);}};
 try {
  if(stage==='discovery') {
   const original=e.requireDiscoveryPage.bind(e);e.requireDiscoveryPage=async(...args)=>{await original(...args);inject();};
  } else if(stage==='artifact') {
   const original=e.artifact.bind(e);e.artifact=async(...args)=>{const result=await original(...args);inject();return result;};
  } else {
   const original=e.readArtifact.bind(e);e.readArtifact=async(...args)=>{const result=await original(...args);inject();return result;};
  }
  const operation=stage==='reuse'?e.artifact(Buffer.from(html),'html'):e.importPage('budgets',sources.budgets.pages[0],html,'authored-offline');
  if(fault)await expect(operation).rejects.toThrow(/cooldown/);else await operation;
  expect(armed).toBe(false);expect(before).toBeDefined();expect(calls()).toBe(2);
  if(fault)expect(logical(e.db)).toEqual(before!);else await e.preflight();
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
type AttemptReceipt={id:string;run:string;kind:string;receipt:string;started:number;ended:number};
function renameRun(e:Engine,id:string,next:string,kind:string) {
 e.db.run('INSERT INTO runs SELECT ?,source,?,started,finished,status,error FROM runs WHERE id=?',[next,kind,id]);
 e.db.run('UPDATE attempts SET run=? WHERE run=?',[next,id]);e.db.run('DELETE FROM runs WHERE id=?',[id]);
}
async function cliStatus(root:string) {
 const argv=[process.execPath,join(import.meta.dir,'../src/cli.ts'),'status','--root',root];
 const child=Bun.spawn(argv,{stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 return {stdout,stderr,exit};
}
for(const mutation of ['wrong-kind','receipt-version','run-version','cap','limits','operation','bad-clock','negative','before-start','after-completion'] as const) test(`F6-B identity rejects open/preflight/CLI status: ${mutation}`,async()=>{
 const f=await fixture();let e:Engine|undefined=f.e;
 try {
  const row=e.db.query<AttemptReceipt,[]>("SELECT a.*,r.kind receipt FROM attempts a JOIN runs r ON r.id=a.run WHERE a.kind='page'").get()!;
  const receipt=JSON.parse(row.receipt.slice('transport-work-v1:'.length));
  if(mutation==='wrong-kind')receipt.kind='pdf';
  if(mutation==='cap')receipt.cap--;
  if(mutation==='limits')receipt.limits.maxBytes=1;
  if(mutation==='operation')receipt.operation='unknown';
  if(mutation==='bad-clock')receipt.headerTiming.clockBasis='monotonic';
  if(mutation==='negative')receipt.headerTiming.observed=-1;
  if(mutation==='before-start')receipt.headerTiming.observed=row.started-1;
  if(mutation==='after-completion')receipt.headerTiming.observed=row.ended+1;
  const value=(mutation==='receipt-version'?'transport-work-v9:':'transport-work-v1:')+JSON.stringify(receipt);
  e.db.run('UPDATE runs SET kind=? WHERE id=?',[value,row.run]);
  if(mutation==='run-version')renameRun(e,row.run,row.run.replace('transport-work-v2:','transport-work-v9:'),value);
  const before=logical(e.db);let preflight=false,open=false;
  try{await e.preflight();}catch{preflight=true;}expect(logical(e.db)).toEqual(before);
  await e.close();e=undefined;
  try{e=await Engine.open(f.root);}catch{open=true;}
  if(e){await e.close();e=undefined;}
  const status=await cliStatus(f.root),check=new Database(join(f.root,'documents.sqlite'));
  try{expect(logical(check)).toEqual(before);}finally{check.close();}
  expect({preflight,open,status:status.exit}).toEqual({preflight:true,open:true,status:1});
  expect(f.calls()).toBe(2);
 }finally{await e?.close();await rm(f.root,{recursive:true,force:true});}
});
for(const version of ['uuid','v1'] as const) test(`F6-B genuine ${version} compatibility open/preflight/CLI status`,async()=>{
 const f=await fixture();let e:Engine|undefined=f.e;
 try {
  const rows=e.db.query<AttemptReceipt,[]>("SELECT a.id,a.run,a.kind,r.kind receipt FROM attempts a JOIN runs r ON r.id=a.run").all();
  for(const row of rows) {
   const receipt=JSON.parse(row.receipt.slice('transport-work-v1:'.length));delete receipt.headerTiming;
   const id=version==='uuid'?crypto.randomUUID():row.run.replace('transport-work-v2:','transport-work-v1:');
   renameRun(e,row.run,id,version==='uuid'?row.kind:'transport-work-v1:'+JSON.stringify(receipt));
  }
  const before=logical(e.db);await e.preflight();expect(logical(e.db)).toEqual(before);
  await e.close();e=await Engine.open(f.root);await e.preflight();expect(logical(e.db)).toEqual(before);
  await e.close();e=undefined;expect((await cliStatus(f.root)).exit).toBe(0);
  const check=new Database(join(f.root,'documents.sqlite'));try{expect(logical(check)).toEqual(before);}finally{check.close();}
 }finally{await e?.close();await rm(f.root,{recursive:true,force:true});}
});
