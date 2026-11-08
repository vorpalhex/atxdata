import { test,expect } from 'bun:test';
import { mkdtemp,rm,readFile,writeFile,symlink,realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Collector,serverDelay } from '../src/collector';
import { replay } from './collector.test';
const scratch=process.env.TMPDIR!;
async function archive(work:(c:Collector,root:string,deps:ReturnType<typeof replay>)=>Promise<void>){const root=await mkdtemp(join(await realpath(scratch),'clarity-guard-'));const deps=replay();let c:Collector|undefined;try{c=await Collector.open(root,deps);await work(c,root,deps);}finally{await c?.close();await rm(root,{recursive:true,force:true});}}
test('actual source robots 404 is retained; transient error body and successful cooldown survive restart',async()=>{
 const root=await mkdtemp(join(await realpath(scratch),'clarity-rate-'));const deps=replay(),base=deps.fetch;let count=0;
 try{
  const c=await Collector.open(root,{...deps,fetch:async(url)=>{
   if(url.endsWith('clarityelections.com/robots.txt')){count++;if(count===1)return new Response('busy',{status:503,headers:{'retry-after':'8'}});return new Response('missing',{status:404,headers:{'content-type':'text/html'}});}
   const r=await base(url);if(url.endsWith('elections.json'))r.headers.set('retry-after','20');return r;
  }});
  await c.collect('125662');
  expect(c.db.query("SELECT count(*) n FROM files WHERE http_status=503 AND status='failed'").get()).toEqual({n:1});
  expect(c.db.query("SELECT count(*) n FROM files WHERE http_status=404 AND status='downloaded'").get()).toEqual({n:1});
  const before=(await c.status()).notBefore;expect(before).toBeGreaterThan(deps.now());await c.close();
  const reopen=await Collector.open(root,deps);expect((await reopen.status()).notBefore).toBe(before);await reopen.verify();await reopen.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
test('malformed content is not retried, failed pending bytes are retained, checkpoint recovery verifies cached originals',async()=>{
 const root=await mkdtemp(join(await realpath(scratch),'clarity-recovery-')),deps=replay(),base=deps.fetch;let fail=true;
 try{
  let c=await Collector.open(root,{...deps,fetch:async(url)=>url.endsWith('summary.json')&&fail?new Response('{broken',{headers:{'content-type':'application/json'}}):base(url)});
  await expect(c.collect('125662')).rejects.toThrow();
  const bad=c.db.query("SELECT path FROM files WHERE status='failed'").get() as {path:string};expect((await readFile(join(root,bad.path+'.pending'))).length).toBe(7);
  c.db.query("UPDATE runs SET status='running' WHERE rowid=(SELECT max(rowid) FROM runs)").run();await c.close();
  fail=false;c=await Collector.open(root,deps);expect(c.db.query("SELECT count(*) n FROM runs WHERE status='interrupted'").get()).toEqual({n:1});
  const result=await c.collect('125662');expect(result.coverage.rows).toBe(1);await c.verify();
  const body=c.db.query("SELECT path FROM files WHERE status='downloaded' LIMIT 1").get() as {path:string};await writeFile(join(root,body.path),'tampered');await expect(c.verify()).rejects.toThrow();await c.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
test('symlinked archives, source checkout output and unsupported elections fail before HTTP',async()=>{
 await archive(async(c,root,deps)=>{await expect(c.collect('../125662')).rejects.toThrow();await expect(c.collect('127492/..')).rejects.toThrow();expect(deps.calls).toEqual([]);await symlink(root,join(root,'alias'));await expect(Collector.open(join(root,'alias'),deps)).rejects.toThrow();});
 await expect(Collector.open(resolveSource())).rejects.toThrow();
});
function resolveSource(){return new URL('..',import.meta.url).pathname.replace(/\/$/,'');}
test('server cooldown representations preserve max delay and reject ambiguity',()=>{
 expect(serverDelay(new Headers({'retry-after':'5','ratelimit-remaining':'0','ratelimit-reset':'8','ratelimit':'"q";r=0;t=10'}),0)).toBe(10000);
 expect(serverDelay(new Headers({'date':'Thu, 01 Jan 1970 00:00:10 GMT','retry-after':'Thu, 01 Jan 1970 00:00:20 GMT','x-ratelimit-remaining':'0','x-ratelimit-reset':'30'}),100)).toBe(20000);
 expect(()=>serverDelay(new Headers({'retry-after':'later'}),0)).toThrow();expect(()=>serverDelay(new Headers({'ratelimit-remaining':'0'}),0)).toThrow();expect(()=>serverDelay(new Headers({'ratelimit':'r=0'}),0)).toThrow();
});
