import {test,expect} from 'bun:test';
import {Engine} from '../src/engine';
import {Transport} from '../src/transport';
import {sources} from '../src/adapters';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';

test('explicit boolean human acknowledgement only overrides encodeplus robots and never leaks from earlier operation',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'human-'))),engine=await Engine.open(root);
 const url='https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx';
 let now=10000;const calls:string[]=[];
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(u:string)=>{calls.push(u);return new Response(u.endsWith('/robots.txt')?'User-agent: *\nDisallow: /regs/\nCrawl-delay: 5':'<p>Archives</p>',{headers:{'content-type':u.endsWith('/robots.txt')?'text/plain':'text/html','retry-after':'7'}});}};
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],`<a href="${url}">Archives</a>`,'authored');
  await expect(new Transport(engine,deps).discover('county-code',url)).rejects.toThrow('robots disallows');
  await new Transport(engine,deps,{}, {human:true}).discover('county-code',url);
  expect(calls).toEqual(['https://online.encodeplus.com/robots.txt',url]);
  const row=engine.db.query<{kind:string},[]>("SELECT r.kind FROM runs r JOIN attempts a ON a.run=r.id WHERE a.kind='page'").get()!;
  expect(JSON.parse(row.kind.split('transport-work-v1:')[1]!).acknowledgement).toMatchObject({human:true,url,matchedRule:'/regs/'});
  const before=calls.length;
  await expect(new Transport(engine,deps).discover('county-code',url)).rejects.toThrow('robots disallows');
  expect(calls.length).toBe(before);
  await engine.preflight();
  for(const mutation of ['missing','rule','origin','hash','nonboolean']) {
   engine.db.exec('SAVEPOINT ack');
   const receipt=JSON.parse(row.kind.split('transport-work-v1:')[1]!);
   if(mutation==='missing') delete receipt.acknowledgement;
   if(mutation==='rule') receipt.acknowledgement.matchedRule='/different/';
   if(mutation==='origin') receipt.acknowledgement.url='https://other.example/regs/traviscounty-tx/';
   if(mutation==='hash') receipt.acknowledgement.robotsSha256='0'.repeat(64);
   if(mutation==='nonboolean') receipt.acknowledgement.human='true';
   engine.db.run('UPDATE runs SET kind=? WHERE kind=?',['transport-work-v1:'+JSON.stringify(receipt),row.kind]);
   await expect(engine.preflight()).rejects.toThrow();
   engine.db.exec('ROLLBACK TO ack; RELEASE ack');
  }
  for(const human of ['true','false',1,null]) expect(()=>new Transport(engine,deps,{}, {human} as any)).toThrow('boolean');
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});

import {robotsDecision,humanScope} from '../src/human-policy';
import {sha} from '../src/engine';
import {transportUrl} from '../src/adapters';
test('human never overrides other authorities, unsafe identity, malformed policy or nonboolean values',()=>{
 const body='User-agent: *\nDisallow: /';
 for(const url of ['https://online.encodeplus.com/regs/other/','https://online.encodeplus.com/regs/traviscounty-tx-evil/','https://online.encodeplus.com/robots.txt','https://online.encodeplus.com.evil/regs/traviscounty-tx/','http://online.encodeplus.com/regs/traviscounty-tx/','https://name@online.encodeplus.com/regs/traviscounty-tx/','https://online.encodeplus.com:999/regs/traviscounty-tx/','https://library.municode.com/regs/traviscounty-tx/']) {
  expect(humanScope(url)).toBe(false);expect(()=>robotsDecision(body,sha(body),url,true)).toThrow();
 }
 const url='https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx';
 for(const value of [false,undefined,'true','false',0,1,null,{}]) expect(()=>robotsDecision(body,sha(body),url,value as any)).toThrow();
 for(const instruction of ['Crawl-delay: corrupt','Request-rate: 1/30']) expect(()=>robotsDecision(body+'\n'+instruction,sha(body),url,true)).toThrow();
 expect(()=>transportUrl('county-code','https://online.encodeplus.com/robots.txt','page')).toThrow();
 expect(()=>transportUrl('budgets','https://online.encodeplus.com/robots.txt','robots')).toThrow();
 expect(()=>transportUrl('county-code','https://online.encodeplus.com/robots.txt?x=1','robots')).toThrow();
});
test('human preserves challenge stops, cooldown and request budget',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'human-stop-'))),engine=await Engine.open(root);
 const url='https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx';
 let calls=0,now=10000;const starts:number[]=[];
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(u:string)=>{calls++;starts.push(now);return new Response(u.endsWith('/robots.txt')?'User-agent: *\nDisallow: /regs/':'Verify you are human',{headers:{'content-type':u.endsWith('/robots.txt')?'text/plain':'text/html','retry-after':'9'}});}};
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],`<a href="${url}">Archives</a>`,'authored');
  const limited=new Transport(engine,deps,{maxRequests:1},{human:true});
  await expect(limited.discover('county-code',url)).rejects.toThrow('operation');expect(calls).toBe(1);
  await expect(new Transport(engine,deps,{}, {human:true}).discover('county-code',url)).rejects.toThrow('challenge');
  expect(starts[1]!-starts[0]!).toBeGreaterThanOrEqual(9000);
  const before=engine.status(),n=calls;
  await expect(new Transport(engine,deps,{}, {human:true}).discover('county-code',url)).rejects.toThrow('stopped');
  expect(calls).toBe(n);expect(engine.status()).toEqual(before);
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});

test('human retains unknown-wire full reservation and refuses any later flagged transfer',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'human-unknown-'))),engine=await Engine.open(root);
 const url='https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx';let now=10000,calls=0;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(u:string)=>{calls++;return u.endsWith('/robots.txt')?new Response('User-agent: *\nDisallow: /regs/',{headers:{'content-type':'text/plain'}}):new Response(new ReadableStream({start(controller){controller.error(Error('interrupted authored fixture'));}}),{headers:{'content-type':'text/html'}});}};
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],`<a href="${url}">Archives</a>`,'authored');
  await expect(new Transport(engine,deps,{}, {human:true}).discover('county-code',url)).rejects.toThrow('interrupted');
  expect(engine.db.query<{bytes:number|null;reservation:number},[]>("SELECT * FROM attempts WHERE kind='page'").get()).toMatchObject({bytes:null,reservation:3145728});
  const before=engine.status();
  await expect(new Transport(engine,deps,{}, {human:true}).discover('county-code',url)).rejects.toThrow('stopped');
  expect(calls).toBe(2);expect(engine.status()).toEqual(before);
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});
