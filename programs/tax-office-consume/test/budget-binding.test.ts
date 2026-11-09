import {test,expect} from 'bun:test';import {Collector} from '../src/collector';import {collect} from '../src/live';import {collectExport} from '../src/export-live';import {retainCatalog,importExport} from '../src/exports';import {sample,pdf,temp} from './collector.test';import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';
test('library validates positive byte and work budgets before offline reuse',async()=>{
 const base=await temp();await writeFile(join(base,'csv'),sample());await writeFile(join(base,'pdf'),pdf);const c=await Collector.open(join(base,'archive'));
 try{await c.importRetained('delinquency',{csv:join(base,'csv'),layout:join(base,'pdf'),maxRows:1});for(const option of [{maxBytes:0},{maxRequests:Infinity},{maxTotalBytes:0}])await expect(collect(c,'delinquency',1,false,option)).rejects.toThrow('budget');}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('explicit catalog version cannot reuse an observation bound to a different catalog',async()=>{
 const base=await temp(),path=join(base,'page');await writeFile(path,'<a href="/voterdata/export.csv">First label CSV</a>');await writeFile(join(base,'raw'),'raw');let calls=0;const c=await Collector.open(join(base,'archive'),{fetch:async()=>{calls++;throw new Error('NO SOURCE REQUEST');}});
 try{const first=await retainCatalog(c,path);await importExport(c,'/voterdata/export.csv',{file:join(base,'raw')});await writeFile(path,'<a href="/voterdata/export.csv">Second label CSV</a>');const second=await retainCatalog(c,path);expect(second.version).not.toBe(first.version);await expect(collectExport(c,'/voterdata/export.csv',{catalogVersion:second.version,version:'not-a-retained-version'})).rejects.toThrow('version');expect(calls).toBe(0);
 // Without an explicit retained observation version, a catalog mismatch is a clear
 // operator decision, not silent reuse of the first label's source binding.
 await expect(collectExport(c,'/voterdata/export.csv',{catalogVersion:second.version})).rejects.toThrow('catalog');expect(calls).toBe(0);
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
