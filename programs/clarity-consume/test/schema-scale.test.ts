import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {CAPS,decode} from '../src/source';
import {parseXml} from '../src/results';
import {multiReplay} from './multi-election.test';
import {xml,zip} from './results.test';
async function run(change:(url:string,r:Response)=>Promise<Response>,check:(c:Collector)=>Promise<void>){
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-scale-')),base=multiReplay();
 const c=await Collector.open(root,{...base,fetch:async u=>change(u,await base.fetch(u))});
 try{await check(c);}finally{await c.close();await rm(root,{recursive:true,force:true});}
}
test('compatible schema/capabilities, not a magic template version, authorize an adapter',async()=>{
 for(const versionTemplate of [1,987654])await run(async(u,r)=>u.endsWith('config.json')?Response.json({...await r.json() as any,versionTemplate}):r,async c=>{const result=await c.collect('009876');expect(result.coverage.mismatches).toEqual([]);expect((await c.verify()).integrity).toBe('ok');});
});
test('unsupported capabilities and schemas stop with actionable adapter errors',async()=>{
 for(const mode of ['unpublished','language','version','zero-version','missing-en','languages-type','settings','summary','xml'])await run(async(u,r)=>{
  if(u.endsWith('config.json')){const v=await r.json() as any;if(mode==='unpublished')v.isPublished=false;if(mode==='language')v.lang='sp';if(mode==='version')v.versionTemplate={unknown:1};if(mode==='zero-version')v.versionTemplate=0;if(mode==='missing-en')v.languages='sp|Spanish';if(mode==='languages-type')v.languages=['en'];return Response.json(v);}
  if(mode==='settings' && u.endsWith('electionsettings.json')){const v=await r.json() as any;v.settings.electiondetails.chkgeneratexml=false;return Response.json(v);}
  if(mode==='xml' && u.endsWith('detailxml.zip'))return new Response(new Uint8Array(zip('<ChangedResultSchema/>')),{headers:{'content-type':'application/zip'}});
  if(mode==='summary' && u.endsWith('summary.json'))return Response.json({newSchema:[]});return r;
 },async c=>{await expect(c.collect('009876')).rejects.toThrow(/adapter|XML not advertised/);});
});
test('countywide-shaped snapshot exceeds old XML, JSON and row caps, reconciles and verifies',async()=>{
 const precincts=Array.from({length:300},(_,i)=>String(i).padStart(3,'0'));
 const choices=['A','B','C'],types=['Mail','Early','Day'];
 const summary:any[]=[],contests:any[]=[];let body='';
 for(let i=1;i<=80;i++){
  const key=String(i);summary.push({K:key,C:'Contest '+key,CH:choices,V:[900,900,900],T:2700,TP:300,PR:0});
  contests.push({K:key,P:precincts,V:precincts.map(()=>[3,3,3]),T:precincts.map(()=>9)});
  body+=`<Contest key="${key}" text="Contest ${key}" precinctsReporting="300" precinctsReported="0">`+choices.map((ch,j)=>`<Choice key="${j}" text="${ch}" totalVotes="900">`+types.map(t=>`<VoteType name="${t}" votes="300">`+precincts.map(p=>`<Precinct name="${p}" votes="1"/>`).join('')+'</VoteType>').join('')+'</Choice>').join('')+'</Contest>';
 }
 const large=xml.replace(/<VoterTurnout.*<\/VoterTurnout>/,`<VoterTurnout totalVoters="1500" ballotsCast="900"><Precincts>`+precincts.map(p=>`<Precinct name="${p}" totalVoters="5" ballotsCast="3" percentReporting="1"/>`).join('')+'</Precincts></VoterTurnout>').replace(/<Contest.*<\/Contest>/,body);
 expect(Buffer.byteLength(large)).toBeGreaterThan(100_000);
 await run(async(u,r)=>{
  if(u.endsWith('detailxml.zip'))return new Response(new Uint8Array(zip(large)),{headers:{'content-type':'application/zip'}});
  if(u.endsWith('summary.json'))return Response.json(summary);
  if(u.endsWith('details.json'))return new Response(JSON.stringify({Contests:contests})+' '.repeat(1_100_000),{headers:{'content-type':'application/json'}});
  if(u.endsWith('status.json'))return Response.json({P:precincts,R:precincts.map(()=>5),B:precincts.map(()=>3),S:precincts.map(()=>1),C:precincts.map(()=>0)});return r;
 },async c=>{const result=await c.collect('125662');expect(result.coverage.rows).toBe(216000);expect(result.coverage.mismatches).toEqual([]);await c.verify();});
});
test('new finite decoded/XML caps remain enforced',()=>{
 expect(CAPS.xmlBytes).toBe(32*1024*1024);expect(CAPS.rows).toBe(1_000_000);expect(CAPS.decodedBytes).toBe(8*1024*1024);
 expect(()=>parseXml(' '.repeat(CAPS.xmlBytes+1))).toThrow();expect(()=>decode(Buffer.alloc(CAPS.decodedBytes+1),null)).toThrow('decoded byte ceiling');
});
