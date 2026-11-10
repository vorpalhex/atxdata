import {test,expect} from 'bun:test';import {Collector} from '../src/collector';import {collect} from '../src/live';import {collectExport,discover} from '../src/export-live';import {retainCatalog,exportLimits,importExport} from '../src/exports';import {parseCatalog} from '../src/catalog';import {sample,pdf,temp} from './collector.test';import {join} from 'node:path';import {writeFile,readFile,rm} from 'node:fs/promises';import {ROUTES} from '../src/source';
const page='<a href="/voterdata/TaxCurOpenData.csv">Tax Current Year and Prior Year Delinquent CSV</a><a href="/pages/CurrentFileLayout.php">Tax Current Year and Prior Year Delinquent File Layout</a>';
const limits=exportLimits({maxBytes:8*1024**2,maxRequests:12,maxTotalBytes:64*1024**2});
test('legacy delinquency reuse cannot return raw current-roll snapshot',async()=>{
 const base=await temp();await writeFile(join(base,'page'),page);await writeFile(join(base,'data'),'arbitrary raw');await writeFile(join(base,'layout'),'current layout raw');let calls=0,now=100000;
 const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async n=>{now+=n;},fetch:async url=>{calls++;if(url===ROUTES.robots)return new Response('',{status:404});if(url===ROUTES.discovery)return new Response('<a href="/voterdata/TaxDelqOpenData.csv">CSV</a><a href="/pages/DelinquentFileLayout.php">layout</a>');return new Response(url===ROUTES.csv?sample():pdf);}});
 try{await retainCatalog(c,join(base,'page'));await importExport(c,'/voterdata/TaxCurOpenData.csv',{file:join(base,'data'),layout:join(base,'layout')});expect(await collect(c,'delinquency',1,false)).toMatchObject({rows:1,reused:false});expect(calls).toBe(4);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('raw collector resumes only missing bound layout, keeps 503 receipts, preserves policy and reuses offline',async()=>{
 const base=await temp();let now=100000,calls:string[]=[],fail=true,end=0;
 const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async n=>{now+=n;},fetch:async(url,init)=>{expect(init.redirect).toBe('manual');expect(init.credentials).toBe('omit');expect(now-end).toBeGreaterThanOrEqual(3000);calls.push(url);end=now;if(url===ROUTES.robots)return new Response('',{status:404});if(url===ROUTES.discovery)return new Response(page);if(url.endsWith('CurrentFileLayout.php'))return new Response(fail?'retained 503 wire body':'raw current layout',{status:fail?503:200,headers:{'Retry-After':'5'}});return new Response('Account,raw text\r\n00001,not money\r\n');}});
 try{
  await discover(c,limits);await expect(collectExport(c,'/voterdata/TaxCurOpenData.csv',{limits})).rejects.toThrow('503');expect(c.status().complete).toBe(0);
  const failed=c.db.query<{path:string},[]>('SELECT path FROM attempts WHERE http_status=503').all();expect(failed).toHaveLength(4);for(const receipt of failed)expect(await readFile(join(c.root,receipt.path),'utf8')).toBe('retained 503 wire body');
  expect(c.status().cooldown).toBeGreaterThanOrEqual(now+5000);fail=false;
  const retained=c.db.query<{path:string},[]>("SELECT path FROM artifacts WHERE kind='data' AND status='validated'").get()!,body=join(c.root,retained.path),original=await readFile(body),beforeCorruption=calls.length;
  await writeFile(body,'tampered partial');for(const options of [{limits},{limits:{...limits,maxRequests:13}},{limits:{...limits,maxRequests:13},refresh:true}]){await expect(collectExport(c,'/voterdata/TaxCurOpenData.csv',options)).rejects.toThrow('artifact hash');expect(calls).toHaveLength(beforeCorruption);}await writeFile(body,original);
  await expect(collectExport(c,'/voterdata/TaxCurOpenData.csv',{limits:{...limits,maxRequests:13}})).rejects.toThrow('refresh');expect(calls).toHaveLength(beforeCorruption);
  c.db.exec("UPDATE snapshots SET mode='unrelated' WHERE source='tax-office/exports' AND status='collecting'");await expect(collectExport(c,'/voterdata/TaxCurOpenData.csv',{limits})).rejects.toThrow('binding identity');expect(calls).toHaveLength(beforeCorruption);c.db.exec("UPDATE snapshots SET mode='raw-live' WHERE source='tax-office/exports' AND status='collecting'");
  const result=await collectExport(c,'/voterdata/TaxCurOpenData.csv',{limits});expect(result).toMatchObject({rows:null,profile:'raw-original'});expect(calls.filter(u=>u.endsWith('TaxCurOpenData.csv'))).toHaveLength(1);
  const before=calls.length;await collectExport(c,'/voterdata/TaxCurOpenData.csv',{limits});expect(calls).toHaveLength(before);expect(await c.verify()).toMatchObject({exports:1});
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('retained observation version remains selectable after publisher removes item from latest catalog',async()=>{
 const base=await temp();await writeFile(join(base,'page'),page);await writeFile(join(base,'data'),'raw');await writeFile(join(base,'layout'),'layout');const c=await Collector.open(join(base,'archive'),{fetch:async()=>{throw new Error('NO HTTP');}});
 try{await retainCatalog(c,join(base,'page'));const saved=await importExport(c,'/voterdata/TaxCurOpenData.csv',{file:join(base,'data'),layout:join(base,'layout')});await writeFile(join(base,'page'),'<a href="/voterdata/another.csv">Another export CSV</a>');await retainCatalog(c,join(base,'page'));expect(await collectExport(c,'/voterdata/TaxCurOpenData.csv',{version:saved.version})).toMatchObject({version:saved.version,reused:true});}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('unbound failed policy continuation requires explicit refresh before a new request',async()=>{
 const base=await temp();await writeFile(join(base,'page'),page);let calls=0;const c=await Collector.open(join(base,'archive'),{fetch:async()=>{calls++;return new Response('User-agent: *\nDisallow: /');}});
 try{await retainCatalog(c,join(base,'page'));await expect(collectExport(c,'/voterdata/TaxCurOpenData.csv',{limits})).rejects.toThrow('instructions');expect(calls).toBe(1);await expect(collectExport(c,'/voterdata/TaxCurOpenData.csv',{limits:{...limits,maxRequests:13}})).rejects.toThrow('refresh');expect(calls).toBe(1);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('catalog ignores comments and foreign/authenticated/account-search links; explicit publisher years only',()=>{
 expect(parseCatalog('<a href="/pages/2026Rates.php">2026 Rates</a><!--<a href="/voterdata/fake.csv">fake</a>--><a href="https://example.invalid/voterdata/fake.csv">foreign</a><a href="/properties/account-search">Account Search</a>')).toMatchObject([{id:'/pages/2026Rates.php',year:'2026',layout:null}]);
});
