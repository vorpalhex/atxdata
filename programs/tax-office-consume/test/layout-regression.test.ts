import {test,expect} from 'bun:test';
import {writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';
import {Collector} from '../src/collector';import {validPdf} from './fixture';import {sample,temp} from './collector.test';
import {createHash} from 'node:crypto';
const hash=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
test('unrelated structurally valid PDF cannot be imported as the delinquency schema',async()=>{
 const base=await temp(),c=await Collector.open(join(base,'archive'));
 try{await writeFile(join(base,'csv'),sample());await writeFile(join(base,'pdf'),validPdf(false));
 await expect(c.importRetained('delinquency',{csv:join(base,'csv'),layout:join(base,'pdf'),maxRows:1})).rejects.toThrow('layout schema');expect(c.status().complete).toBe(0);
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('verify rejects substituted unrelated PDF even with recomputed artifact and version hashes',async()=>{
 const base=await temp(),c=await Collector.open(join(base,'archive'));
 try{const {id,run}=c.start('delinquency',1,'retained');const csv=await c.retain(id,run,'csv',sample()),raw=validPdf(false);await c.retain(id,run,'layout',raw);
 c.db.run("INSERT INTO rows VALUES(?,1,?,?,NULL)",[id,'00000000000001',JSON.stringify(sample().toString().trimEnd().split('\r\n')[1]!.split(','))]);
 c.db.run("UPDATE snapshots SET status='complete',version=?,row_count=1 WHERE id=?",[hash(Buffer.from(csv.hash+':'+hash(raw))),id]);c.finish(run,'succeeded');
 await expect(c.verify()).rejects.toThrow('layout schema');
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
