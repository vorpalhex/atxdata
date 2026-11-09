import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';

for(const status of [200,400]) for(const mode of ['structured','maximum','numeric','date','standard','legacy','malformed']) test(`immediate restart preserves ${mode} cooldown from HTTP ${status} at nonzero clock`,async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-restart-'));
 let clock=100_000;const starts:number[]=[];
 const headers:Record<string,string>={'content-type':'text/plain',ratelimit:'"a";r = 0;t = 60, "b";r=0;t=40'};
 if(mode==='maximum')Object.assign(headers,{'retry-after':new Date(180_000).toUTCString(),date:new Date(100_000).toUTCString(),'ratelimit-remaining':'0','ratelimit-reset':'70','x-ratelimit-remaining':'0','x-ratelimit-reset':'190'});
 if(['numeric','date','standard','legacy'].includes(mode))delete headers.ratelimit;
 if(mode==='numeric')headers['retry-after']='60';
 if(mode==='date')Object.assign(headers,{'retry-after':new Date(180_000).toUTCString(),date:new Date(100_000).toUTCString()});
 if(mode==='standard')Object.assign(headers,{'ratelimit-remaining':'0','ratelimit-reset':'70'});
 if(mode==='legacy')Object.assign(headers,{'x-ratelimit-remaining':'0','x-ratelimit-reset':'190'});
 if(mode==='malformed')headers.ratelimit='"a";r = 0;t = later';
 const deps={now:()=>clock,sleep:async(ms:number)=>{clock+=ms},random:()=>0,fetch:async()=>{starts.push(clock);return new Response('User-agent: *\nDisallow: /',{status,headers});}};
 let c=await Collector.open(root,deps);
 try{
  await expect(c.collect('125662')).rejects.toThrow();await c.close();c=await Collector.open(root,deps);
  await expect(c.collect('125662')).rejects.toThrow();
  const until=mode==='maximum'||mode==='legacy'?190_000:mode==='date'?180_000:mode==='standard'?170_000:160_000;
  expect(starts).toEqual(mode==='malformed'?[100_000]:[100_000,until]);
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});

test('retry attempt number and jitter cooldown survive interruption before the next attempt',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-jitter-restart-'));
 let clock=100_000,interrupt=true;const starts:number[]=[];
 const deps={now:()=>clock,random:()=>0.5,sleep:async(ms:number)=>{if(interrupt)throw new Error('local interruption');clock+=ms},fetch:async()=>{
  starts.push(clock);return new Response(starts.length<4?'retry':'User-agent: *\nDisallow: /',{status:starts.length<4?500:200,headers:{'content-type':'text/plain'}});
 }};
 let c=await Collector.open(root,deps);
 try{
  await expect(c.collect('125662')).rejects.toThrow('local interruption');expect(starts).toEqual([100_000]);await c.close();interrupt=false;c=await Collector.open(root,deps);
  await expect(c.collect('125662')).rejects.toThrow('review');expect(starts).toEqual([100_000,103_500,108_000,116_500]);
  expect(c.db.query('SELECT count(*) n FROM files').get()).toEqual({n:4});
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
