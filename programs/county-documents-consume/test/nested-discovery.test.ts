import {expect,test} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Engine} from '../src/engine';
import {Transport} from '../src/transport';
import {sources,discover} from '../src/adapters';
import {pageLinks} from '../src/discovery';

test('source-linked nested discovery supports arbitrary annual pages, cycle-safe continuation and denies unlinked routes',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'nested-'))),engine=await Engine.open(root);
 const base=sources.budgets.pages[0],nested='https://www.traviscountytx.gov/planning-budget/archive/fy-2032';
 let now=1000;const calls:string[]=[];
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  calls.push(url);
  if(url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow:',{headers:{'content-type':'text/plain'}});
  const html=url===base?`<a href="${nested}">FY 2032 Budget archive</a><a href="/news">Unrelated</a>`:`<h1>Fiscal Year 2032</h1><h2>Adopted Budget</h2><a href="/images/a.pdf">Volume II</a><a href="${base}">Back</a>`;
  return new Response(html,{headers:{'content-type':'text/html'}});
 }};
 try {
  await expect(engine.importPage('budgets',nested,'','fixture')).rejects.toThrow('source-linked');
  const transport=new Transport(engine,deps,{maxPages:1});
  const first=await transport.discoverTree('budgets',base);
  expect(first.complete).toBe(false);expect(first.pending).toContain(nested);
  expect(calls).toHaveLength(2);
  const next=await new Transport(engine,deps,{maxPages:4}).discoverTree('budgets',nested);
  expect(next.complete).toBe(true);
  expect(engine.list('budgets',{year:'2032',role:'adopted',limit:20})).toHaveLength(1);
  expect(calls.filter(url=>url===nested)).toHaveLength(1);
  await expect(new Transport(engine,deps).discover('budgets','https://www.traviscountytx.gov/news')).rejects.toThrow('source-linked');
  // Legacy parser/receipts remain replayable rather than gaining documents retroactively.
  expect(discover('county-code',sources['county-code'].pages[0],'<h2>Title 30</h2><a href="/t.pdf">Title 30</a>',2)).toHaveLength(0);
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});

test('Title 30 official PDF is discoverable without interpreting it as a Chapter 30',()=>{
 const row=discover('county-code',sources['county-code'].pages[0],'<h2>Title 30</h2><a href="/t.pdf">Title 30 Joint Code</a>')[0];
 expect(row).toMatchObject({role:'title-30',chapter:null});
});
test('source-linked graph excludes staff, records requests and polling/worker navigation',()=>{
 expect(pageLinks('budgets',sources.budgets.pages[0],'<a href="/planning-budget/contact">Budget Staff</a><a href="/planning-budget/public-information">Request Information</a><a href="/planning-budget/fy11-content">FY 11 Adopted Budget</a>').map(row=>row.url)).toEqual(['https://www.traviscountytx.gov/planning-budget/fy11-content']);
 expect(pageLinks('election-documents',sources['election-documents'].pages[0],'<a href="/current-election-information/become-an-election-worker/">Become an Election Worker</a>')).toEqual([]);
});
