import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,readFile,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';

function cityPdf() {
 const text='City of Austin Quarterly Financial Report Fiscal Year 2031';
 const stream=`BT /F1 12 Tf 10 180 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let out='%PDF-1.4\n';const offsets=[0];
 for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const xref=Buffer.byteLength(out);out+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(out);
}

test('native Austin eDIMS acquisition preserves services robots302 and final policy; reuse and refresh',async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,'austin-native-'));
 const archive=join(root,'archive'),pdf=cityPdf(),calls:{url:string;at:number}[]=[];
 const page='https://www.austintexas.gov/budget-excellence/data-and-insights';
 const doc='https://services.austintexas.gov/edims/document.cfm?id=123456';
 let interrupt=false,bodyStarted:()=>void=()=>{};
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
  const url=req.headers.get('x-authored-url')!;calls.push({url,at:Date.now()});
  expect(req.headers.get('cookie')).toBeNull();
  if(url==='https://services.austintexas.gov/robots.txt') return new Response('canonical policy',{status:302,headers:{location:'https://www.austintexas.gov/robots.txt','content-type':'text/plain'}});
  if(url==='https://www.austintexas.gov/robots.txt') return new Response('User-agent: *\nAllow: /\n',{headers:{'content-type':'text/plain'}});
  if(url===page) return new Response(`<h1>City of Austin</h1><h2>FY 2031</h2><a href="${doc}">Quarterly Financial Report</a>`,{headers:{'content-type':'text/html'}});
  if(url===doc && interrupt) return new Response(new ReadableStream({start(controller){controller.enqueue(pdf.subarray(0,32));setTimeout(()=>bodyStarted(),200);}}),{headers:{'content-type':'application/pdf','content-length':String(pdf.length)}});
  if(url===doc) return new Response(pdf,{headers:{'content-type':'application/pdf'}});
  return new Response('unmapped authored URL',{status:404});
 }});
 const preload=join(root,'preload.ts');
 const encoding=join(import.meta.dir,'../src/encoding.ts'),cli=join(import.meta.dir,'../src/cli.ts');
 await writeFile(preload,`import {mock} from 'bun:test';const path=${JSON.stringify(encoding)};const original={...await import(path)};mock.module(path,()=>({...original,rawFetch:(url,init={})=>{const headers=new Headers(init.headers);headers.set('x-authored-url',url);return original.rawFetch(${JSON.stringify(server.url.href)},{...init,headers});}}));`);
 let sequence=0;
 const invoke=async(command:string,extra:string[]=[],target=archive,expected=0)=>{
  const args=[process.execPath,'--preload',preload,cli,command,'--root',target,'--source','austin-financial-publications',...extra];
  const child=Bun.spawn(args,{env:{...process.env,BUN_RUNTIME_TRANSPILER_CACHE_PATH:''},stdout:'pipe',stderr:'pipe'});
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  await writeFile(join(root,String(++sequence)+'-'+command+'.json'),JSON.stringify({args,exit,stdout,stderr}));
  expect(exit).toBe(expected);if(expected!==0)return stderr;expect(stderr).toBe('');return JSON.parse(stdout);
 };
 try {
  await invoke('discover',['--page',page,'--allow-network']);
  await invoke('collect',['--limit','1','--allow-network']);
  const db=new Database(join(archive,'documents.sqlite'),{readonly:true});
  const original=db.query<any,[]>('SELECT * FROM attempts WHERE status=302').get();expect(original.url).toBe('https://services.austintexas.gov/robots.txt');expect(original.error).toBeNull();
  const version=db.query<any,[]>('SELECT * FROM versions').get();expect(version.sha).toBe(createHash('sha256').update(pdf).digest('hex'));
  expect(Buffer.from(await readFile(join(archive,version.path))).equals(pdf)).toBe(true);
  expect(db.query('SELECT COUNT(*) n FROM robots_bindings').get()).toEqual({n:1});db.close();
  const before=calls.length;
  await invoke('collect',['--limit','1','--allow-network']);await invoke('verify',['--limit','1']);expect(calls.length).toBe(before);
  await invoke('sync',['--limit','1','--allow-network']);expect(calls.length).toBe(before+1);
  for(let i=1;i<calls.length;i++) expect(calls[i]!.at-calls[i-1]!.at).toBeGreaterThanOrEqual(2950);
  for(const [name,sql,category] of [
   ['edge',"UPDATE redirect_edges SET target_url='https://other.invalid/robots.txt'",/redirect/],
   ['policy',"UPDATE robots_bindings SET final_attempt=redirect_attempt",/policy binding/],
   ['metadata',"UPDATE snapshot_metadata SET adapter_schema=3",/metadata version/],
   ['county',"UPDATE observations SET evidence=json_set(evidence,'$.administeringCounty','Travis')",/inventory/],
  ] as const) {
   const target=join(root,name);await cp(archive,target,{recursive:true});
   const fault=new Database(join(target,'documents.sqlite'));fault.run(sql);fault.exec('PRAGMA wal_checkpoint(TRUNCATE)');fault.close();
   const bytes=await readFile(join(target,'documents.sqlite')),n=calls.length;
   expect(await invoke('verify',['--limit','1'],target,1)).toMatch(category);
   expect(calls.length).toBe(n);expect((await readFile(join(target,'documents.sqlite'))).equals(bytes)).toBe(true);
  }
  const n=calls.length;
  expect(await invoke('collect',['--limit','1','--allow-network','--max-pdf-bytes','1'],archive,1)).toMatch(/budget|limit/);
  expect(calls.length).toBe(n);
  const seed=join(root,'seed.html');await writeFile(seed,`<h2>FY 2031</h2><a href="${doc}">Quarterly Financial Report</a>`);
  const bounded=join(root,'bounded');await invoke('import-page',['--page',page,'--input',seed,'--origin','authored-fixture'],bounded);
  const start=calls.length;
  expect(await invoke('collect',['--limit','1','--allow-network','--max-requests','1'],bounded,1)).toMatch(/budget/);
  expect(calls.length).toBe(start+1);
  const stopped=new Database(join(bounded,'documents.sqlite'),{readonly:true});
  expect(stopped.query<any,[]>('SELECT blocked FROM cooldowns').get().blocked).toMatch(/redirect chain pending/);
  expect(stopped.query('SELECT status,error FROM attempts').get()).toEqual({status:302,error:null});stopped.close();
  expect(await invoke('sync',['--limit','1','--allow-network'],bounded,1)).toMatch(/stopped/);expect(calls.length).toBe(start+1);
  const interrupted=join(root,'interrupted');await cp(archive,interrupted,{recursive:true});interrupt=true;
  const arrival=new Promise<void>(resolve=>{bodyStarted=resolve;});
  const child=Bun.spawn([process.execPath,'--preload',preload,cli,'sync','--root',interrupted,'--source','austin-financial-publications','--limit','1','--allow-network'],{env:{...process.env,BUN_RUNTIME_TRANSPILER_CACHE_PATH:''},stdout:'pipe',stderr:'pipe'});
  await Promise.race([arrival,Bun.sleep(8000).then(()=>{throw Error('authored partial response not reached');})]);
  child.kill('SIGKILL');await child.exited;
  const partial=new Database(join(interrupted,'documents.sqlite'),{readonly:true});
  expect(partial.query<any,[]>('SELECT status,ended,sha FROM attempts ORDER BY rowid DESC LIMIT 1').get()).toEqual({status:200,ended:null,sha:null});
  expect(partial.query<any,[]>('SELECT blocked FROM cooldowns').get().blocked).toMatch(/unfinished/);partial.close();
  const afterKill=calls.length,bytes=await readFile(join(interrupted,'documents.sqlite'));
  expect(await invoke('sync',['--limit','1','--allow-network'],interrupted,1)).toMatch(/EEXIST/);expect(calls.length).toBe(afterKill);expect((await readFile(join(interrupted,'documents.sqlite'))).equals(bytes)).toBe(true);
  // Explicit test-only retired-owner copy: preserve original lock and all durable evidence.
  const retired=join(root,'interrupted-retired');await cp(interrupted,retired,{recursive:true,filter:(from)=>!from.endsWith('/.civicclerk.lock')});
  expect(await invoke('sync',['--limit','1','--allow-network'],retired,1)).toMatch(/stopped/);expect(calls.length).toBe(afterKill);
 }finally{server.stop(true);}
},60000);
