import {test,expect} from 'bun:test';import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';import {Collector} from '../src/collector';import {sample,pdf,temp} from './collector.test';
const corruptions=[
 ['failed completion',"UPDATE runs SET status='failed',error='corrupt' WHERE snapshot=?"],
 ['command',"UPDATE runs SET command='other' WHERE snapshot=?"],
 ['limits',"UPDATE runs SET limits='{}' WHERE snapshot=?"],
 ['no finish',"UPDATE runs SET finished_at=NULL WHERE snapshot=?"],
 ['invalid finish',"UPDATE runs SET finished_at='not a date' WHERE snapshot=?"],
 ['reverse finish',"UPDATE runs SET finished_at='1900-01-01T00:00:00.000Z' WHERE snapshot=?"],
 ['success with error',"UPDATE runs SET error='unexpected' WHERE snapshot=?"],
 ['invalid observation',"UPDATE snapshots SET observed_at='not a date' WHERE id=?"],
 ['invalid start',"UPDATE runs SET started_at='not a date' WHERE snapshot=?"],
 ['missing completion identity',"UPDATE snapshots SET completion_run=NULL WHERE id=?"],
 ['wrong completion identity',"UPDATE snapshots SET completion_run=(SELECT id FROM runs WHERE snapshot<>? LIMIT 1) WHERE id=?"],
 ['snapshot mode',"UPDATE snapshots SET mode='live' WHERE id=?"],
] as const;
for(const reuse of [false,true])for(const [name,sql] of corruptions)test(`verify rejects isolated ${reuse?'reuse':'completion'} ${name} corruption`,async()=>{
 const base=await temp(),c=await Collector.open(join(base,'archive'));await writeFile(join(base,'csv'),sample());await writeFile(join(base,'pdf'),pdf);
 try{const options={csv:join(base,'csv'),layout:join(base,'pdf'),maxRows:1};let result=await c.importRetained('delinquency',options);if(reuse)result=await c.importRetained('delinquency',options);expect((await c.verify()).rows).toBe(1);
 c.db.run(sql,sql.includes('snapshot<>?')?[result.snapshot,result.snapshot]:[result.snapshot]);await expect(c.verify()).rejects.toThrow('run provenance');
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
