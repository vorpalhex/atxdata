import {test,expect} from 'bun:test';
import {Engine} from '../src/engine';
import {Transport} from '../src/transport';
import {sources} from '../src/adapters';
import {verifyTransportLedger} from '../src/transport-integrity';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';

test('F1 rejects arbitrary and downgraded operation identities and exact reservation forgery',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'repair-f1-'))),engine=await Engine.open(root);
 let now=10000;
 try {
  await new Transport(engine,{now:()=>now,sleep:async(ms)=>{now+=ms;},fetch:async(url)=>new Response(url.endsWith('/robots.txt')?'User-agent: *\nDisallow:':'<a href="/a.pdf">Chapter 2</a>',{headers:{'content-type':url.endsWith('/robots.txt')?'text/plain':'text/html'}})}).discover('county-code',sources['county-code'].pages[0]);
  verifyTransportLedger(engine);
  const run=engine.db.query<{id:string;kind:string},[]>("SELECT r.* FROM runs r JOIN attempts a ON a.run=r.id LIMIT 1").get()!;
  for(const kind of ['not-a-valid-legacy-or-operation-kind','page','transport-work-v2:{}']) {
   engine.db.run('UPDATE runs SET kind=? WHERE id=?',[kind,run.id]);
   expect(()=>verifyTransportLedger(engine)).toThrow();
  }
  engine.db.run('UPDATE runs SET kind=? WHERE id=?',[run.kind,run.id]);
  verifyTransportLedger(engine);
  const pageRun=engine.db.query<{id:string;kind:string},[]>("SELECT r.* FROM runs r JOIN attempts a ON a.run=r.id WHERE a.kind='page'").get()!;
  engine.db.run('UPDATE runs SET kind=? WHERE id=?',['page',pageRun.id]);
  expect(()=>verifyTransportLedger(engine)).toThrow('identity');
  engine.db.run('UPDATE runs SET kind=? WHERE id=?',[pageRun.kind,pageRun.id]);
  const pdfRun=engine.start('county-code','placeholder'),id=crypto.randomUUID(),operation=crypto.randomUUID();
  const limits={maxRequests:2,maxBytes:4000000,maxPdfBytes:3000000,maxPages:2};
  const receipt='transport-work-v1:'+JSON.stringify({operation,kind:'pdf',cap:1,limits});
  engine.db.run('UPDATE runs SET kind=? WHERE id=?',[receipt,pdfRun]);
  engine.db.run("INSERT INTO attempts(id,run,url,kind,started,reservation) VALUES(?,?,?,'pdf',10000,1)",[id,pdfRun,'https://www.traviscountytx.gov/a.pdf']);
  engine.db.run("UPDATE cooldowns SET blocked='unfinished attempt requires operator review'");
  expect(()=>verifyTransportLedger(engine)).toThrow('reservation');
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});

test('F2 retained inventory corruption rejects root discovery before any HTTP or mutation',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'repair-f2-'))),engine=await Engine.open(root);
 let calls=0,now=10000;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{calls++;return new Response(url.endsWith('/robots.txt')?'User-agent: *\nDisallow:':'<a href="/a.pdf">Chapter 2</a>',{headers:{'content-type':url.endsWith('/robots.txt')?'text/plain':'text/html'}});}};
 try {
  await new Transport(engine,deps).discover('county-code',sources['county-code'].pages[0]);
  engine.db.run('UPDATE snapshot_metadata SET observation_count=999');
  const before=engine.status(),oldCalls=calls;
  await expect(new Transport(engine,deps).discover('county-code',sources['county-code'].pages[0])).rejects.toThrow('observation inventory mismatch');
  expect(calls).toBe(oldCalls);expect(engine.status()).toEqual(before);
  await expect(new Transport(engine,deps).discover('county-code','https://www.traviscountytx.gov/commissioners-court/county-code/history')).rejects.toThrow('observation inventory mismatch');
  await expect(new Transport(engine,deps).collect(engine.list('county-code',{limit:1})[0]!.id)).rejects.toThrow('observation inventory mismatch');
  await expect(new Transport(engine,deps).resolveDecodedRobots('not-a-recovery-target','authored recovery check')).rejects.toThrow('observation inventory mismatch');
  expect(calls).toBe(oldCalls);expect(engine.status()).toEqual(before);
  await expect(engine.importPage('county-code',sources['county-code'].pages[0],'<p>replacement</p>','authored')).rejects.toThrow('observation inventory mismatch');
  expect(engine.status()).toEqual(before);
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});

test('F3 exact encodeplus robots authority is scoped to robots operation',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'repair-f3-'))),engine=await Engine.open(root);
 const url='https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx',calls:string[]=[];
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],`<a href="${url}">Archives</a>`,'authored');
  const transport=new Transport(engine,{fetch:async(u)=>{calls.push(u);return new Response('User-agent: *\nDisallow: /regs/',{headers:{'content-type':'text/plain'}});}});
  await expect(transport.discover('county-code',url)).rejects.toThrow('robots disallow');
  expect(calls).toEqual(['https://online.encodeplus.com/robots.txt']);
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});

import {chmod,writeFile} from 'node:fs/promises';
import {renderIdentity} from '../src/pdf';
import {fixturePdf} from './engine.test';
test('F2 integrity rendering does not require writing to retained archive directory',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'readonly-render-')));
 try {
  const path=join(root,'original.pdf');await writeFile(path,fixturePdf());await chmod(root,0o500);
  expect((await renderIdentity(path,root)).length).toBeGreaterThan(0);
 }finally {await chmod(root,0o700);await rm(root,{recursive:true,force:true});}
});

test('F1 reconstructs exact remaining reservation from prior actual bodies, not coordinated receipt/cap agreement',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'reservation-edge-'))),engine=await Engine.open(root);
 let now=10000;
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],'<a href="/a.pdf">Chapter 2 A</a><a href="/b.pdf">Chapter 2 B</a>','authored');
  const transport=new Transport(engine,{now:()=>now,sleep:async(ms)=>{now+=ms;},fetch:async(url)=>new Response(url.endsWith('/robots.txt')?'User-agent: *\nDisallow:':fixturePdf(),{headers:{'content-type':url.endsWith('/robots.txt')?'text/plain':'application/pdf'}})},{maxBytes:3145728,maxPdfBytes:3145728});
  for(const row of engine.list('county-code',{limit:2})) await transport.collect(row.id);
  verifyTransportLedger(engine);
  const rows=engine.db.query<{id:string;run:string;reservation:number;kind:string},[]>("SELECT a.id,a.run,a.reservation,r.kind FROM attempts a JOIN runs r ON a.run=r.id WHERE a.kind='pdf' ORDER BY a.rowid").all();
  expect(rows[1]!.reservation).toBe(rows[0]!.reservation-fixturePdf().length);
  for(const row of rows) {
   engine.db.exec('SAVEPOINT cap');
   const receipt=JSON.parse(row.kind.slice('transport-work-v1:'.length));receipt.cap--;
   engine.db.run('UPDATE attempts SET reservation=? WHERE id=?',[row.reservation-1,row.id]);
   engine.db.run('UPDATE runs SET kind=? WHERE id=?',['transport-work-v1:'+JSON.stringify(receipt),row.run]);
   expect(()=>verifyTransportLedger(engine)).toThrow('exact operation reservation');
   engine.db.exec('ROLLBACK TO cap; RELEASE cap');
  }
  verifyTransportLedger(engine);
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});
