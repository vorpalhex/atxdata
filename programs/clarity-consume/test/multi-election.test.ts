import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {COUNTY} from '../src/source';
import {replay} from './collector.test';
import {xml,zip} from './results.test';

// Authored fixtures: IDs, dates and template tokens are not retrieved originals.
export function multiReplay(){
 const base=replay(),calls:string[]=[];
 const entries=[{State:'TX',StateId:'9',County:'Travis',CountyId:'1239',EID:'125662',ElectionName:'Test',Date:'12/13/2025 12:00:00 AM'},
 {State:'TX',StateId:'9',County:'Travis',CountyId:'1239',EID:'009876',ElectionName:'General fixture',Date:'11/03/2026 12:00:00 AM'}];
 return {...base,calls,entries,fetch:async(url:string)=>{
  calls.push(url);
  if(url===COUNTY+'elections.json')return Response.json(entries);
  const second=url.startsWith(COUNTY+'009876/');
  const response=await base.fetch(second?url.replace('/009876/','/125662/'):url);
  if(!second)return response;
  if(url.endsWith('detailxml.zip'))return new Response(new Uint8Array(zip(xml.replace('>Test<','>General fixture<').replace('12/13/2025','11/03/2026'))),{headers:{'content-type':'application/zip'}});
  if(url.endsWith('electionsettings.json')){const s=await response.json() as any;Object.assign(s.settings.electiondetails,{electionid:'009876',internalname:'General fixture',electiondate:'11/03/2026'});return Response.json(s);}
  return response;
 }};
}
export async function fixture(check:(c:Collector,d:ReturnType<typeof multiReplay>,root:string)=>Promise<void>){
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-multi-')),d=multiReplay(),c=await Collector.open(root,d);
 try{await check(c,d,root);}finally{await c.close();await rm(root,{recursive:true,force:true});}
}
test('catalog date selects the second election and cached date reuse performs zero HTTP',async()=>{
 await fixture(async(c,d)=>{
  const result=await c.collectDate('2026-11-03');expect(result.reused).toBe(false);
  expect(c.db.query('SELECT election FROM observations').get()).toEqual({election:'009876'});
  expect((await c.collectDate('2026-11-03')).reused).toBe(true);expect(d.calls.length).toBe(12);
 });
});
test('second catalog election retains literal leading zeroes, coexists, and verifies offline',async()=>{
 await fixture(async(c,d)=>{
  await c.collect('009876');await c.collect('125662');
  expect((await c.verify()).observations).toBe(2);expect(d.calls.length).toBe(24);
  expect(c.db.query('SELECT election FROM observations ORDER BY rowid').all()).toEqual([{election:'009876'},{election:'125662'}]);
  expect((await c.collect('009876')).reused).toBe(true);expect(d.calls.length).toBe(24);
 });
});
