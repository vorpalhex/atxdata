import {expect,test} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Engine} from '../src/engine';
import {Transport} from '../src/transport';
import {sources} from '../src/adapters';
import {fixturePdf} from './engine.test';

const faults:Record<string,string>={
 'missing timestamp column':'ALTER TABLE cooldowns DROP COLUMN not_before',
 'missing blocked column':'ALTER TABLE cooldowns DROP COLUMN blocked',
 'ambiguous timestamp':"UPDATE cooldowns SET not_before='ambiguous'",
 'negative timestamp':'UPDATE cooldowns SET not_before=-1',
 'fractional timestamp':'UPDATE cooldowns SET not_before=0.5',
 'unsafe timestamp':'UPDATE cooldowns SET not_before=9007199254740992',
 'infinite timestamp':'UPDATE cooldowns SET not_before=1e999',
 'blob timestamp':"UPDATE cooldowns SET not_before=x'01'",
 'empty stop reason':"UPDATE cooldowns SET blocked=''",
 'whitespace stop reason':"UPDATE cooldowns SET blocked='  '",
 'blob stop reason':"UPDATE cooldowns SET blocked=x'01'",
 'missing singleton':'DELETE FROM cooldowns',
 'extra singleton':'PRAGMA ignore_check_constraints=ON; INSERT INTO cooldowns VALUES(2,0,NULL)',
};
for(const [name,sql] of Object.entries(faults)) test(`cooldown ${name} refuses verify and fetch without ledger writes`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-integrity-'))),e=await Engine.open(root);
 try{
  await e.importPage('county-code',sources['county-code'].pages[0],'<a href="/2.pdf">Chapter 2</a>','fixture');
  await e.importPdf(e.list('county-code',{limit:1})[0]!.id,fixturePdf(),'application/pdf','fixture');
  let calls=0;
  const deps={now:()=>2000000000000,sleep:async()=>{throw Error('PROBE sleep must not happen');},fetch:async()=>{calls++;throw Error('PROBE fetch must not happen');}};
  const t=new Transport(e,deps); // Also catch damage after construction, not just open-time validation.
  e.db.exec(sql);
  const gateBefore=e.db.query('SELECT * FROM cooldowns').all(),attemptsBefore=e.db.query('SELECT * FROM attempts').all();
  let verifyError='',transportError='';
  try{await e.verify('county-code',{chapter:'2',limit:1});}catch(error){verifyError=String(error);}
  try{await t.discover('budgets',sources.budgets.pages[0]);}catch(error){transportError=String(error);}
  expect(calls).toBe(0);
  expect(e.db.query('SELECT * FROM attempts').all()).toEqual(attemptsBefore);
  expect(e.db.query('SELECT * FROM cooldowns').all()).toEqual(gateBefore);
  expect(verifyError).toMatch(/cooldown|schema/);
  expect(transportError).toMatch(/cooldown|schema/);
  expect(()=>new Transport(e,deps)).toThrow();
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});

test('distinct transport instances pace from completed body, not response headers',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cooldown-spacing-'))),e=await Engine.open(root);
 let now=10000,sleeps=0;
 const starts:number[]=[],completions:number[]=[];
 const deps={now:()=>now,sleep:async(ms:number)=>{sleeps++;now+=ms;},fetch:async(url:string)=>{
  starts.push(now);
  const body=url.endsWith('robots.txt')?'User-agent: *\nDisallow:':'<h2>FY 2030</h2><a href="/tax.pdf">Taxpayer Impact Statement</a>';
  return new Response(new ReadableStream({async pull(controller){await Bun.sleep(1);now+=700;controller.enqueue(new TextEncoder().encode(body));controller.close();completions.push(now);}}),{headers:{'content-type':url.endsWith('robots.txt')?'text/plain':'text/html'}});
 }};
 try{
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[0]);
  await new Transport(e,deps).discover('budgets',sources.budgets.pages[1]);
  expect(starts).toHaveLength(3); // robots + two page bodies, reused robots policy.
  expect(completions).toHaveLength(3);
  expect(sleeps).toBe(2);
  for(let i=1;i<starts.length;i++)expect(starts[i]!-completions[i-1]!).toBeGreaterThanOrEqual(2000);
  const rows=e.db.query<{started:number;ended:number},[]>('SELECT started,ended FROM attempts ORDER BY rowid').all();
  expect(rows.map(r=>r.started)).toEqual(starts);
  expect(rows.map(r=>r.ended)).toEqual(completions);
  expect(e.db.query<{not_before:number},[]>('SELECT not_before FROM cooldowns').get()!.not_before).toBe(now+2000);
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
