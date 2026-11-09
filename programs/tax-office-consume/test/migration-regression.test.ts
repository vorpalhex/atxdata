import {test,expect} from 'bun:test';import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';import {Collector} from '../src/collector';import {sample,pdf,temp} from './collector.test';
for(const corrupt of [false,true])test('legacy terminal binding is conservative '+corrupt,async()=>{
 const base=await temp(),root=join(base,'archive');let c=await Collector.open(root);await writeFile(join(base,'csv'),sample());await writeFile(join(base,'pdf'),pdf);
 try{await c.importRetained('delinquency',{csv:join(base,'csv'),layout:join(base,'pdf'),maxRows:1});c.db.run('ALTER TABLE snapshots DROP COLUMN completion_run');if(corrupt)c.db.run("UPDATE runs SET status='failed',error='corrupted historical status'");}finally{await c.close();}
 c=await Collector.open(root);try{if(corrupt)await expect(c.verify()).rejects.toThrow('run provenance');else expect((await c.verify()).rows).toBe(1);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
