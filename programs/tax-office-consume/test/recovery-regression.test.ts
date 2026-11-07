import {test,expect} from 'bun:test';import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';
import {Collector} from '../src/collector';import {collect} from '../src/live';import {run as cli} from '../src/cli';import {ROUTES} from '../src/source';import {sample,pdf,temp} from './collector.test';
test('explicit live refresh leaves failed checkpoint intact and accepts changed valid bytes in a new snapshot',async()=>{
 const base=await temp();let phase=0,now=10000;const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async url=>{
  if(url===ROUTES.robots)return new Response('',{status:404});if(url===ROUTES.discovery)return new Response('/voterdata/TaxDelqOpenData.csv DelinquentFileLayout.php');
  return new Response(url===ROUTES.csv?(phase?Buffer.from(sample().toString().replaceAll('\r\n','\n')):sample()):(phase?pdf:Buffer.from('bad PDF')));
 }});
 try{await expect(collect(c,'delinquency',1,true)).rejects.toThrow('PDF');const prior=c.db.query<{id:string},[]>('SELECT id FROM snapshots').get()!;phase=1;
 const result=await collect(c,'delinquency',1,true);expect(result.snapshot).not.toBe(prior.id);expect((await c.verify()).rows).toBe(1);expect(c.status().failed).toBe(1);
 expect(c.db.query('SELECT status FROM snapshots WHERE id=?').get(prior.id)).toEqual({status:'abandoned'});expect(c.db.query('SELECT count(*) n FROM artifacts WHERE snapshot=?').get(prior.id)).toEqual({n:1});
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('retained explicit refresh is distinct from same-byte checkpoint resume and keeps failed history',async()=>{
 const base=await temp(),root=join(base,'archive'),csv=join(base,'csv'),layout=join(base,'pdf');await writeFile(csv,sample());let c=await Collector.open(root);
 try{await expect(c.importRetained('delinquency',{csv,layout,maxRows:1})).rejects.toThrow();}finally{await c.close();}
 await writeFile(csv,sample().toString().replaceAll('\r\n','\n'));await writeFile(layout,pdf);
 try{await expect(cli(['import','--selection','delinquency','--max-rows','1','--csv',csv,'--layout',layout,'--output',root,'--refresh'])).resolves.toMatchObject({rows:1});
 c=await Collector.open(root);try{expect((await c.verify()).rows).toBe(1);expect(c.status().failed).toBe(1);expect(c.db.query('SELECT count(*) n FROM snapshots').get()).toEqual({n:2});}finally{await c.close();}
 }finally{await rm(base,{recursive:true,force:true});}
});
