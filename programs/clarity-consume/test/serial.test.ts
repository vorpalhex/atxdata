import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {replay} from './collector.test';
test('a stalled full body holds the request slot; starts are paced after completion and concurrent operations refuse',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-serial-')),deps=replay(),base=deps.fetch;let finish!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>started=r);const starts:number[]=[];
 const c=await Collector.open(root,{...deps,fetch:async(url)=>{
  starts.push(deps.now());
  if(starts.length===1)return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('User-agent: *'));finish=()=>controller.close();started();}}),{headers:{'content-type':'text/plain'}});
  return base(url);
 }});
 try{const collecting=c.collect('125662');await gate;expect(starts.length).toBe(1);await expect(c.collect('125662')).rejects.toThrow('one operation');expect(starts.length).toBe(1);finish();await collecting;
  expect(starts.length).toBe(12);for(let i=1;i<starts.length;i++)expect(starts[i]-starts[i-1]).toBeGreaterThanOrEqual(3000);
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
test('atomic promotion never clobbers an existing destination and retains the attempted original body',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-clobber-')),deps=replay(),base=deps.fetch;let c!:Collector;
 c=await Collector.open(root,{...deps,fetch:async(url)=>{
  const row=c.db.query("SELECT path FROM files WHERE status='requesting' ORDER BY rowid DESC LIMIT 1").get() as {path:string};
  await writeFile(join(root,row.path),'existing',{flag:'wx'});return base(url);
 }});
 try{await expect(c.collect('125662')).rejects.toThrow();const row=c.db.query('SELECT path,status FROM files').get() as {path:string;status:string};expect(row.status).toBe('failed');expect((await readFile(join(root,row.path))).toString()).toBe('existing');expect((await readFile(join(root,row.path+'.pending'))).length).toBeGreaterThan(0);
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
