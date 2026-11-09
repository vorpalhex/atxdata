// Standalone fresh-process native regression. Only URL translation; no client reader/Response envelope.
import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {Collector} from '../src/collector';import {collect} from '../src/live';import {HEADER,CAPS} from '../src/source';import {validPdf} from './fixture';
const failure=process.argv[2]==='503',base=await mkdtemp(join(process.env.TMPDIR!,'tax-native-worker-')),root=join(base,'archive');
const detached:string[]=[];process.on('unhandledRejection',e=>{detached.push(String(e));process.exitCode=1;});
const hash=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
const row=HEADER.map(()=>'');Object.assign(row,{0:'00000000000001',1:'2025',3:'0',4:'0',5:'0',6:'0',7:'0',8:'0',10:'0',11:'0',12:'0',13:'1',30:'x'.repeat(1600000)});
const csv=Buffer.from(HEADER.join(',')+'\r\n'+row.join(',')+'\r\n'),pdf=validPdf();
const content=new Map<string,{body:Buffer;status:number}>([
 ['/robots.txt',{body:Buffer.from('go'),status:302}],['/404',{body:Buffer.from('<title>404</title>Page not found'),status:200}],
 ['/pages/property.php',{body:Buffer.from('/voterdata/TaxDelqOpenData.csv DelinquentFileLayout.php'),status:200}],
 ['/voterdata/TaxDelqOpenData.csv',{body:csv,status:200}],['/pages/DelinquentFileLayout.php',{body:pdf,status:200}],
]);
let index=0;const files=new Map<string,string>();for(const [path,item] of content){const file=join(base,'response-'+index++);await writeFile(file,item.body);files.set(path,file);}
let calls=0,credentials=0;const paths:string[]=[];
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>{
 calls++;const path=new URL(req.url).pathname;paths.push(path);if(req.headers.has('cookie')||req.headers.has('authorization'))credentials++;
 const item=content.get(path);if(!item)throw new Error('unexpected local route');
 return new Response(Bun.file(files.get(failure?'/voterdata/TaxDelqOpenData.csv':path)!).stream(),{status:failure?503:item.status,headers:path==='/robots.txt'&&!failure?{Location:'/404'}:{}});
}});
let now=10000;const c=await Collector.open(root,{now:()=>now,sleep:async ms=>{now+=ms;}}),native=c.deps.fetch;
c.deps.fetch=(url,init)=>{assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');return native(new URL(new URL(url).pathname,server.url).href,init);};
let summary:unknown;
try{
 if(failure){await assert.rejects(collect(c,'delinquency',1,true),/HTTP 503/);assert.equal(calls,4);assert.deepEqual(c.status(),{complete:0,failed:1,cooldown:now+3000});}
 else{const result=await collect(c,'delinquency',1,true);assert.equal(result.rows,1);assert.equal(calls,5);assert.deepEqual(await c.verify(),{snapshots:1,rows:1,httpRequests:0});assert.deepEqual(paths,[...content.keys()]);}
 const attempts=c.db.query<any,[]>('SELECT * FROM attempts ORDER BY rowid').all();assert.equal(attempts.length,failure?4:5);
 for(const a of attempts){const expected=content.get(new URL(a.url).pathname)!;const actual=await readFile(join(root,a.path));const expectedBody=failure?csv:expected.body;assert.equal(hash(actual),hash(expectedBody));assert.equal(actual.length,expectedBody.length);assert.equal(a.http_status,failure?503:expected.status);assert.equal(a.status,failure?'failed':'validated');assert.equal(a.bytes,failure?CAPS.robots:actual.length);if(failure)assert.match(a.error,/HTTP 503/);else assert.equal(a.error,null);}
 const artifacts=c.db.query<any,[]>('SELECT * FROM artifacts ORDER BY kind').all();assert.equal(artifacts.length,failure?0:2);
 for(const a of artifacts){const expected=a.kind==='csv'?csv:pdf;assert.equal(a.hash,hash(expected));assert.equal(hash(await readFile(join(root,a.path))),hash(expected));}
 assert.equal(credentials,0);await Bun.sleep(10);assert.deepEqual(detached,[]);
 summary={ok:true,mode:failure?'503':'success',root,calls,credentials,paths,status:c.status(),attempts:attempts.map(a=>({status:a.status,http_status:a.http_status,bytes:a.bytes,error:a.error})),artifacts:artifacts.map(a=>({kind:a.kind,hash:a.hash,bytes:a.bytes})),detached};
}catch(error){summary={ok:false,root,calls,error:String(error),stack:(error as Error).stack,detached};process.exitCode=1;}
finally{await c.close();server.stop(true);}
console.log(JSON.stringify(summary));if(!process.env.TAX_KEEP_RUNTIME&&process.exitCode!==1)await rm(base,{recursive:true,force:true});
