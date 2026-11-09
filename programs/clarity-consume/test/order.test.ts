import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {replay} from './collector.test';
import {xml,zip} from './results.test';
test('offline normalized row comparison follows SQLite binary vote-type order, not host locale',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-order-')),deps=replay(),base=deps.fetch;
 const c=await Collector.open(root,{...deps,fetch:async(url)=>url.endsWith('detailxml.zip')?new Response(new Uint8Array(zip(xml.replace('name="Mail"','name="Early Voting"').replace('</Choice>','<VoteType name="ED Provisional" votes="0"><Precinct name="001" votes="0"/></VoteType></Choice>'))),{headers:{'content-type':'application/zip'}}):base(url)});
 try{await c.collect('125662');expect((await c.verify()).integrity).toBe('ok');}finally{await c.close();await rm(root,{recursive:true,force:true});}
});
