import { test,expect } from 'bun:test';
import { mkdtemp,rm,readFile,symlink,mkdir,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collector } from '../src/collector';
import { xml,zip,summary,details,status } from './results.test';
import { COUNTY,HOST,OFFICIAL } from '../src/source';
export function replay() {
 let calls:string[]=[];let clock=0;
 const election={State:'TX',StateId:'9',County:'Travis',CountyId:'1239',EID:'125662',ElectionName:'Test',Date:'12/13/2025 12:00:00 AM'};
 const map:Record<string,any>={ 'config':{lang:'en',isPublished:true,versionTemplate:345435},'settings':{settings:{electiondetails:{electionid:'125662',entityid:'1239',electiondate:'12/13/2025',internalname:'Test',chkgeneratexml:true,chkisfinalupload:false,chkiscanvasupload:false}},pagesettings:{web:{header:'Official Results'}}},summary,details,status };
 return {calls,now:()=>clock,sleep:async(ms:number)=>{clock+=ms;},random:()=>0,fetch:async(url:string)=>{
  calls.push(url);
  const suffixes=['json/config.json','json/en/electionsettings.json','json/en/summary.json','json/status.json','json/details.json','reports/detailxml.zip'];
  const allowed=new Set([HOST+'/robots.txt','https://votetravis.gov/robots.txt',OFFICIAL,COUNTY+'elections.json',COUNTY+'125662/current_ver.txt',...['367565','367566'].flatMap(v=>suffixes.map(s=>COUNTY+'125662/'+v+'/'+s))]);
  if(!allowed.has(url))throw new Error('unexpected exact source route '+url);
  if(url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /wp-admin/\n',{headers:{'content-type':'text/plain'}});
  if(url===OFFICIAL) return new Response(`<a href="${COUNTY}">Results</a>`,{headers:{'content-type':'text/html'}});
  if(url.endsWith('elections.json')) return Response.json([election]);
  if(url.endsWith('current_ver.txt')) return new Response('367565',{headers:{'content-type':'text/plain'}});
  if(url.endsWith('detailxml.zip')) return new Response(new Uint8Array(zip(xml)),{headers:{'content-type':'application/zip'}});
  const key=url.endsWith('electionsettings.json')?'settings':url.split('/').at(-1)!.replace('.json','');
  if(!map[key]) throw new Error('unexpected route '+url);
  return Response.json(map[key]);
 }};
}
test('one selected snapshot persists provenance and scoped rows; duplicate and offline verification perform zero HTTP',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR ?? tmpdir()),'clarity-test-')); const deps=replay();
 try{
  const c=await Collector.open(root,deps);
  const result=await c.collect('125662');
  expect(result.coverage).toMatchObject({contests:1,choices:1,precincts:1,rows:1,registered:5,ballots:3,votes:2,stable:true,mismatches:[],certification:'not established'});expect(result.reused).toBe(false);
  expect(deps.calls.length).toBe(12);
  expect(c.db.query('SELECT count(*) n FROM result_rows').get()).toEqual({n:1});
  expect(c.db.query('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
  expect(c.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  await c.collect('125662');await c.verify(); expect(deps.calls.length).toBe(12);
  expect(await c.status()).toMatchObject({observations:1,files:12});
  await expect(Collector.open(root,deps)).rejects.toThrow();
  await c.close();
  const offline=await Collector.open(root,{fetch:async()=>{throw new Error('HTTP forbidden');}});
  await offline.verify();await offline.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
