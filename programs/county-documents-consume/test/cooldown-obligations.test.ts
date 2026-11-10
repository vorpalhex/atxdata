import {expect,test} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {Engine} from '../src/engine';
import {Transport} from '../src/transport';
import {sources} from '../src/adapters';

const html='<h2>FY 2030</h2><a href="/tax.pdf">Taxpayer Impact Statement</a>';
function state(e:Engine) {
 return Object.fromEntries(['cooldowns','attempts','runs','robots','representations','snapshots','observations'].map(t=>[t,e.db.query(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
}
for(const fault of [false,true]) test(`retained successful server hold across reopen: rollback=${fault}`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-obligation-')));
 let e:Engine|undefined=await Engine.open(root),now=10000,calls=0;
 const starts:number[]=[];
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  calls++;starts.push(now);
  return new Response(url.endsWith('robots.txt')?'User-agent: *\nDisallow:':'<h2>FY 2030</h2><a href="/tax.pdf">Taxpayer Impact Statement</a>',{headers:{'content-type':url.endsWith('robots.txt')?'text/plain':'text/html',...(url.endsWith('robots.txt')?{}:{'retry-after':'120'})}});
 }};
 try {
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);
  const deadline=e.db.query<{not_before:number},[]>('SELECT not_before FROM cooldowns').get()!.not_before;
  await e.close();e=undefined;
  const db=new Database(join(root,'documents.sqlite'));
  if(fault) db.run('UPDATE cooldowns SET not_before=0');db.close();
  if(fault) {
   await expect(Engine.open(root)).rejects.toThrow(/cooldown/);
   expect(calls).toBe(2);
   const check=new Database(join(root,'documents.sqlite'));
   expect(check.query<{not_before:number},[]>('SELECT not_before FROM cooldowns').get()!.not_before).toBe(0);check.close();
  } else {
   e=await Engine.open(root);await e.preflight();
   await new Transport(e,deps).discover('budgets',sources.budgets.pages[1]);
   expect(starts[2]).toBeGreaterThanOrEqual(deadline);
  }
 }finally{await e?.close();await rm(root,{recursive:true,force:true});}
});

test('gate-only rollback refuses offline mutations and transport without silent advance',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-open-'))),e=await Engine.open(root);
 let now=10000,calls=0;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  calls++;return new Response(url.endsWith('robots.txt')?'User-agent: *\nCrawl-delay: 10\nDisallow:':'<h2>FY 2030</h2><a href="/tax.pdf">Taxpayer Impact Statement</a>',{headers:{'content-type':url.endsWith('robots.txt')?'text/plain':'text/html'}});
 }};
 try {
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);
  e.db.run('UPDATE cooldowns SET not_before=0');const before=state(e);
  await expect(e.preflight()).rejects.toThrow(/cooldown/);
  await expect(e.importPage('budgets',sources.budgets.pages[0],'<p>new</p>','fixture')).rejects.toThrow(/cooldown/);
  await expect(e.verify('budgets',{limit:1})).rejects.toThrow(/cooldown/);
  await expect(new Transport(e,deps).discover('budgets',sources.budgets.pages[1])).rejects.toThrow(/cooldown/);
  expect(calls).toBe(2);expect(state(e)).toEqual(before);
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
const holds:[string,Record<string,string>,number][]=[
 ['minimum',{},2000],['robots',{},10000],['retry numeric',{'retry-after':'120'},2000],
 ['retry date',{'retry-after':'Tue, 14 Nov 2023 22:15:20 GMT','date':'Tue, 14 Nov 2023 22:13:20 GMT'},2000],
 ['standard reset',{'ratelimit-remaining':'0','ratelimit-reset':'120'},2000],
 ['absolute reset',{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1700000120'},2000],
 ['structured',{'ratelimit':'limit=100; r=0; t=120'},2000],
];
for(const [name,headers,delay] of holds) test(`one millisecond rollback rejects retained ${name} obligation`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-boundary-'))),e=await Engine.open(root);
 let now=1700000000000,calls=0;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  calls++;now+=500; // Header receipt is not request start.
  const robots=url.endsWith('robots.txt');
  return new Response(robots?`User-agent: *\nCrawl-delay: ${delay/1000}\nDisallow:`:html,{headers:{'content-type':robots?'text/plain':'text/html',...(robots?{}:headers)}});
 }};
 try {
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);
  await e.preflight();
  e.db.run('UPDATE cooldowns SET not_before=not_before-1');const before=state(e);
  await expect(new Transport(e,deps).discover('budgets',sources.budgets.pages[1])).rejects.toThrow(/cooldown/);
  expect(calls).toBe(2);expect(state(e)).toEqual(before);
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
for(const bodyMs of [500,2000]) test(`absolute Reset remains absolute when body consumes ${bodyMs} ms`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-reset-')));
 let e:Engine|undefined=await Engine.open(root),now=1700000000000;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  const robots=url.endsWith('robots.txt'),reset=String((now+1000)/1000);
  return new Response(new ReadableStream({async pull(controller){await Bun.sleep(1);now+=robots?0:bodyMs;controller.enqueue(new TextEncoder().encode(robots?'User-agent: *\nDisallow:':html));controller.close();}}),{headers:{'content-type':robots?'text/plain':'text/html',...(robots?{}:{'x-ratelimit-remaining':'0','x-ratelimit-reset':reset})}});
 }};
 try {
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);
  const before=state(e);expect(e.list('budgets',{limit:1})).toHaveLength(1);
  const row=e.db.query<{ended:number;kind:string},[]>("SELECT a.ended,r.kind FROM attempts a JOIN runs r ON r.id=a.run WHERE a.kind='page'").get()!;
  const timing=JSON.parse(row.kind.slice('transport-work-v1:'.length)).headerTiming;
  expect(row.ended-timing.observed).toBe(bodyMs);
  expect(e.db.query<{not_before:number},[]>('SELECT not_before FROM cooldowns').get()!.not_before).toBe(row.ended+3000);
  await e.close();e=await Engine.open(root);await e.preflight();expect(state(e)).toEqual(before);
 }finally{await e?.close();await rm(root,{recursive:true,force:true});}
});
test('longer holds and explicit manual stops remain unchanged; missing new timing is not synthesized',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-facts-'))),e=await Engine.open(root);
 let now=10000;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>new Response(url.endsWith('robots.txt')?'User-agent: *\nDisallow:':html,{headers:{'content-type':url.endsWith('robots.txt')?'text/plain':'text/html'}})};
 try {
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);
  e.db.run("UPDATE cooldowns SET not_before=not_before+50000,blocked='manual operator stop'");
  const before=state(e);await e.preflight();
  await expect(new Transport(e,deps).discover('budgets',sources.budgets.pages[1])).rejects.toThrow(/stopped/);
  expect(state(e)).toEqual(before);
  for(const row of e.db.query<{id:string;kind:string},[]>("SELECT id,kind FROM runs WHERE id LIKE 'transport-work-v2:%'").all()) {
   const receipt=JSON.parse(row.kind.slice('transport-work-v1:'.length));delete receipt.headerTiming;
   e.db.run('UPDATE runs SET kind=? WHERE id=?',['transport-work-v1:'+JSON.stringify(receipt),row.id]);
  }
  const damaged=state(e);await expect(e.preflight()).rejects.toThrow(/cooldown/);expect(state(e)).toEqual(damaged);
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
test('rollback during awaited sleep refuses before reservation or HTTP',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-sleep-'))),e=await Engine.open(root);
 let now=10000,calls=0,damage=false,before:ReturnType<typeof state>;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;if(damage){e.db.run('UPDATE cooldowns SET not_before=0');before=state(e);}},fetch:async(url:string)=>{
  calls++;return new Response(url.endsWith('robots.txt')?'User-agent: *\nDisallow:':html,{headers:{'content-type':url.endsWith('robots.txt')?'text/plain':'text/html'}});
 }};
 try {
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);damage=true;
  await expect(new Transport(e,deps).discover('budgets',sources.budgets.pages[1])).rejects.toThrow(/cooldown/);
  expect(calls).toBe(2);expect(state(e)).toEqual(before!);
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
for(const hold of [false,true]) test(`old receipts remain explicit without timing fabrication: server hold=${hold}`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-old-'))),e=await Engine.open(root);
 let now=10000;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  const robots=url.endsWith('robots.txt');
  return new Response(new ReadableStream({async pull(c){await Bun.sleep(1);now+=700;c.enqueue(new TextEncoder().encode(robots?'User-agent: *\nDisallow:':html));c.close();}}),{headers:{'content-type':robots?'text/plain':'text/html',...(!robots && hold?{'retry-after':'120'}:{})}});
 }};
 try {
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);
  for(const row of e.db.query<{id:string;kind:string},[]>("SELECT id,kind FROM runs WHERE id LIKE 'transport-work-v2:%'").all()) {
   const receipt=JSON.parse(row.kind.slice('transport-work-v1:'.length));delete receipt.headerTiming;
   const oldId=row.id.replace('transport-work-v2:','transport-work-v1:');
   e.db.run('INSERT INTO runs SELECT ?,source,?,started,finished,status,error FROM runs WHERE id=?',[oldId,'transport-work-v1:'+JSON.stringify(receipt),row.id]);
   e.db.run('UPDATE attempts SET run=? WHERE run=?',[oldId,row.id]);e.db.run('DELETE FROM runs WHERE id=?',[row.id]);
  }
  const before=state(e);
  if(hold) await expect(e.preflight()).rejects.toThrow(/cooldown/); // Exact old header time genuinely unavailable.
  else await e.preflight();
  expect(state(e)).toEqual(before);
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
test('relative server holds use retained header receipt, not body completion',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-receipt-')));
 let e:Engine|undefined=await Engine.open(root),now=10000;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  const robots=url.endsWith('robots.txt');now+=500;
  return new Response(new ReadableStream({async pull(c){await Bun.sleep(1);now+=700;c.enqueue(new TextEncoder().encode(robots?'User-agent: *\nDisallow:':html));c.close();}}),{headers:{'content-type':robots?'text/plain':'text/html',...(robots?{}:{'retry-after':'120'})}});
 }};
 try {
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);
  const row=e.db.query<{kind:string},[]>("SELECT r.kind FROM attempts a JOIN runs r ON r.id=a.run WHERE a.kind='page'").get()!;
  const observed=JSON.parse(row.kind.slice('transport-work-v1:'.length)).headerTiming.observed;
  expect(e.db.query<{not_before:number},[]>('SELECT not_before FROM cooldowns').get()!.not_before).toBe(observed+120000);
  const before=state(e);await e.close();e=await Engine.open(root);await e.preflight();expect(state(e)).toEqual(before);
 }finally{await e?.close();await rm(root,{recursive:true,force:true});}
});
