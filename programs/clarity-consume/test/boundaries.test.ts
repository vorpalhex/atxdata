import {test,expect,spyOn} from 'bun:test';
import {mkdtemp,realpath,rm,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync,crc32} from 'node:zlib';
import {Collector} from '../src/collector';
import {main} from '../src/cli';
import {CAPS,hash} from '../src/source';
import {xmlFromZip,parseXml} from '../src/results';
import {xml,zip} from './results.test';
import {replay} from './collector.test';
const temporary=async()=>mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-boundary-'));

for(const extra of [3,4])test(`request ceiling is inclusive: ${extra} extra attempts`,async()=>{
 const root=await temporary(),base=replay(),seen=new Set<string>();let calls=0,retries=0;
 const c=await Collector.open(root,{...base,fetch:async url=>{calls++;if(!seen.has(url)&&retries<extra){seen.add(url);retries++;return new Response('retry',{status:500});}return base.fetch(url);}});
 try{
  if(extra===3){await c.collect('125662');await c.verify();}else await expect(c.collect('125662')).rejects.toThrow('ceiling');
  expect(calls).toBe(15);expect(c.db.query('SELECT count(*) n FROM files').get()).toEqual({n:15});
  expect(c.db.query("SELECT count(*) n FROM files WHERE name='export' AND status='downloaded'").get()).toEqual({n:1});
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});

for(const overflow of [false,true])test(`failed bytes count toward inclusive cumulative cap (overflow=${overflow})`,async()=>{
 const root=await temporary();let calls=0,clock=0;
 const c=await Collector.open(root,{now:()=>clock,sleep:async ms=>{clock+=ms},random:()=>0,fetch:async()=>{
  calls++;const n=calls===1?CAPS.fileBytes:CAPS.totalBytes-CAPS.fileBytes;
  let sent=false;return new Response(new ReadableStream({pull(controller){if(!sent){sent=true;controller.enqueue(new Uint8Array(n));if(overflow&&calls===2)controller.enqueue(new Uint8Array(1));controller.close();}}}),{status:500,headers:{'content-type':'text/plain','content-length':String(n)}});
 }});
 try{
  await expect(c.collect('125662')).rejects.toThrow('ceiling');expect(calls).toBe(2);
  const files=c.db.query<any,[]>('SELECT * FROM files ORDER BY rowid').all();expect(files.map(f=>f.bytes)).toEqual([12_000_000,8_000_000]);
  for(const f of files){expect(f.status).toBe('failed');expect((await stat(join(root,f.path+'.pending'))).size).toBe(f.bytes);await expect(stat(join(root,f.path))).rejects.toThrow();}
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});

for(const length of ['matching','smaller','larger','malformed'])test(`positive Content-Length ${length} retains correct success/failure evidence`,async()=>{
 const root=await temporary(),base=replay();let summaryLength=0;
 const c=await Collector.open(root,{...base,fetch:async url=>{
  const r=await base.fetch(url),bytes=new Uint8Array(await r.arrayBuffer()),headers=new Headers(r.headers);let declared=String(bytes.length);
  if(url.endsWith('/summary.json')){summaryLength=bytes.length;declared=length==='smaller'?String(bytes.length-1):length==='larger'?String(bytes.length+1):length==='malformed'?'2x':declared;}
  headers.set('content-length',declared);return new Response(bytes,{status:r.status,headers});
 }});
 try{
  if(length==='matching'){await c.collect('125662');await c.verify();}else await expect(c.collect('125662')).rejects.toThrow();
  const row=c.db.query<any,[]>('SELECT * FROM files WHERE name=\'summary\'').get()!;
  expect(row.status).toBe(length==='matching'?'downloaded':'failed');
  if(length!=='malformed')expect((await readFile(join(root,row.path+(length==='matching'?'':'.pending')))).length).toBe(summaryLength);
  expect(c.db.query("SELECT count(*) n FROM files WHERE name='summary'").get()).toEqual({n:1});
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});

for(const error of [408,429,500,599,'timeout','transport'])test(`retry taxonomy and deterministic nonzero jitter for ${error}`,async()=>{
 const root=await temporary(),base=replay();let clock=100_000;const starts:number[]=[];
 const c=await Collector.open(root,{now:()=>clock,sleep:async ms=>{clock+=ms},random:()=>0.5,fetch:async url=>{
  starts.push(clock);if(starts.length<=3){
   if(error==='timeout')throw new DOMException('local timeout','TimeoutError');
   if(error==='transport')throw new TypeError('local transport');
   return new Response(new ReadableStream({start(controller){clock+=200;controller.enqueue(new TextEncoder().encode('failed bytes'));controller.close();}}),{status:error as number});
  }return base.fetch(url);
 }});
 try{await c.collect('125662');const body=typeof error==='number'?200:0;expect(starts.slice(0,4)).toEqual([100_000,103_500+body,108_000+body*2,116_500+body*3]);await c.verify();}
 finally{await c.close();await rm(root,{recursive:true,force:true});}
});
for(const status of [400,409,425,499])test(`permanent HTTP ${status} does not retry`,async()=>{
 const root=await temporary();let calls=0;const c=await Collector.open(root,{fetch:async()=>{calls++;return new Response('no',{status});}});
 try{await expect(c.collect('125662')).rejects.toThrow();expect(calls).toBe(1);}finally{await c.close();await rm(root,{recursive:true,force:true});}
});

test('same incomplete observation refreshes robots/link gates before any result route',async()=>{
 for(const policy of ['robots','link']){
  const root=await temporary(),base=replay();let phase=0;const seen:string[]=[];
  const deps={...base,fetch:async(url:string)=>{seen.push(url);if(phase===0&&url.endsWith('/summary.json'))throw new Error('local stop');if(phase===1&&policy==='robots'&&url.endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow: /',{headers:{'content-type':'text/plain'}});if(phase===1&&policy==='link'&&url.includes('election-results-and-reconciliation-forms'))return new Response('link removed',{headers:{'content-type':'text/html'}});return base.fetch(url);}};
  let c=await Collector.open(root,deps);
  try{await expect(c.collect('125662')).rejects.toThrow('local stop');const id=(await c.status()).coverage[0];await c.close();phase=1;seen.length=0;c=await Collector.open(root,deps);await expect(c.collect('125662')).rejects.toThrow();expect((await c.status()).observations).toBe(1);expect(seen.length).toBe(policy==='robots'?1:3);expect(seen.some(u=>u.includes('/json/')||u.endsWith('current_ver.txt'))).toBe(false);}
  finally{await c.close();await rm(root,{recursive:true,force:true});}
 }
});

test('default Bun.fetch preserves encoded gzip and positive main collect/sync reuses verified scope',async()=>{
 const root=await temporary(),base=replay();let clock=100_000;const options:any[]=[];
 const fetchSpy=spyOn(Bun,'fetch').mockImplementation((async(url:any,init:any)=>{
  options.push(init);const response=await base.fetch(String(url));
  if(String(url).endsWith('/summary.json')){const bytes=Buffer.from(await response.arrayBuffer());return new Response(new Uint8Array(gzipSync(bytes)),{headers:{'content-type':'application/json','content-encoding':'gzip'}});}return response;
 }) as typeof Bun.fetch);
 const nowSpy=spyOn(Date,'now').mockImplementation(()=>clock),sleepSpy=spyOn(Bun,'sleep').mockImplementation((async(ms:any)=>{clock+=Number(ms);}) as typeof Bun.sleep);
 try{
  expect(await main(['collect','--archive',root,'--election','125662'])).toMatchObject({reused:false});
  expect(await main(['sync','--archive',root,'--election','125662'])).toMatchObject({reused:true});expect(options.length).toBe(12);
  expect(options.every(o=>o.decompress===false&&o.redirect==='manual')).toBe(true);
  const c=await Collector.open(root);try{const row=c.db.query<any,[]>('SELECT * FROM files WHERE name=\'summary\'').get()!;expect(row.encoded_hash).not.toBe(row.decoded_hash);expect(hash(await readFile(join(root,row.path)))).toBe(row.encoded_hash);expect(await c.verify()).toMatchObject({httpRequests:0,observations:1});}finally{await c.close();}
 }finally{fetchSpy.mockRestore();nowSpy.mockRestore();sleepSpy.mockRestore();await rm(root,{recursive:true,force:true});}
});

test('CRC-valid ZIP invalid UTF8 is rejected and numeric/boolean-looking XML text stays literal',()=>{
 const text=xml.replace('<ElectionName>Test</ElectionName>','<ElectionName>001</ElectionName>').replace(/<Timestamp>[^<]*<\/Timestamp>/,'<Timestamp>false</Timestamp>');
 expect(parseXml(text)).toMatchObject({name:'001',timestamp:'false'});
 const raw=Buffer.from(zip(xml)),c=40+Buffer.byteLength(xml),body=raw.subarray(40,c);body[body.indexOf('Test')]=0xff;const crc=crc32(body);raw.writeUInt32LE(crc,14);raw.writeUInt32LE(crc,c+16);expect(()=>xmlFromZip(raw)).toThrow();
 for(const [local,central,value] of [[6,c+8,1],[8,c+10,9]]){const b=Buffer.from(zip(xml));b.writeUInt16LE(value,local);b.writeUInt16LE(value,central);expect(()=>xmlFromZip(b)).toThrow();}
});
