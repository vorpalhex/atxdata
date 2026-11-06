import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {hash} from '../src/source';
import {replay} from './collector.test';

test('offline identity rejects independent one-field provenance mistakes with zero HTTP',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-identity-')),deps=replay();
 const c=await Collector.open(root,deps);
 try{
  await c.collect('125662');const calls=deps.calls.length;
  c.db.run("INSERT INTO elections SELECT '115627',source,label,event_date,metadata FROM elections LIMIT 1");
  const changes=[
   ["UPDATE observations SET election='115627'","UPDATE observations SET election='125662'"],
   ["UPDATE files SET url='https://example.invalid/not-the-source' WHERE name='export'","UPDATE files SET url='https://results.enr.clarityelections.com/TX/Travis/125662/367565/reports/detailxml.zip' WHERE name='export'"],
   ["UPDATE observations SET version='367566'","UPDATE observations SET version='367565'"],
   ["UPDATE observations SET after_version='367566'","UPDATE observations SET after_version='367565'"],
   ["UPDATE observations SET status='disagreement'","UPDATE observations SET status='complete'"],
   ["UPDATE observations SET status='collecting'","UPDATE observations SET status='complete'"],
   ["UPDATE files SET http_status=500 WHERE name='export'","UPDATE files SET http_status=200 WHERE name='export'"],
   ["UPDATE files SET status='failed' WHERE name='config'","UPDATE files SET status='downloaded' WHERE name='config'"],
   ["UPDATE sources SET county_id='99'","UPDATE sources SET county_id='1239'"],
   ["UPDATE elections SET source='bad' WHERE id='125662'","UPDATE elections SET source='TX/Travis' WHERE id='125662'"],
   ["UPDATE elections SET source='missing' WHERE id='115627'","UPDATE elections SET source='TX/Travis' WHERE id='115627'"],
   ["UPDATE elections SET label='Other' WHERE id='125662'","UPDATE elections SET label='Test' WHERE id='125662'"],
   ["UPDATE elections SET event_date='Other' WHERE id='125662'","UPDATE elections SET event_date='12/13/2025 12:00:00 AM' WHERE id='125662'"],
   ["UPDATE elections SET metadata=json_set(metadata,'$.ElectionName','Other') WHERE id='125662'","UPDATE elections SET metadata=json_set(metadata,'$.ElectionName','Test') WHERE id='125662'"],
   ["UPDATE selections SET election='115627'","UPDATE selections SET election='125662'"],
  ];
  for(const [bad,restore] of changes){c.db.run('PRAGMA foreign_keys=OFF');c.db.run(bad);await expect(c.verify()).rejects.toThrow();c.db.run(restore);c.db.run('PRAGMA foreign_keys=ON');await c.verify();}
  for(const name of ['config','catalog','settings']){
   const row=c.db.query<any,[string]>('SELECT * FROM files WHERE name=?').get(name)!;const path=join(root,row.path),bytes=await readFile(path),value=JSON.parse(bytes.toString());
   if(name==='config')value.versionTemplate=1;
   if(name==='catalog')value[0].CountyId='99';
   if(name==='settings')value.settings.electiondetails.internalname='Other';
   const bad=Buffer.from(JSON.stringify(value));await writeFile(path,bad);c.db.run('UPDATE files SET bytes=?,encoded_hash=?,decoded_hash=? WHERE id=?',[bad.length,hash(bad),hash(bad),row.id]);
   await expect(c.verify()).rejects.toThrow();await writeFile(path,bytes);c.db.run('UPDATE files SET bytes=?,encoded_hash=?,decoded_hash=? WHERE id=?',[row.bytes,row.encoded_hash,row.decoded_hash,row.id]);await c.verify();
  }
  const originalConfig=c.db.query<any,[]>('SELECT * FROM files WHERE name=\'config\'').get()!;
  c.db.run("INSERT INTO files SELECT 'duplicate-config',observation,run,name,url,path,status,started_at,retrieved_at,http_status,headers,encoded_hash,decoded_hash,bytes,error FROM files WHERE id=?",[originalConfig.id]);
  c.db.run("UPDATE files SET url='https://example.invalid/older-attempt' WHERE id=?",[originalConfig.id]);
  await expect(c.verify()).rejects.toThrow();
  c.db.run('UPDATE files SET url=? WHERE id=?',[originalConfig.url,originalConfig.id]);c.db.run("DELETE FROM files WHERE id='duplicate-config'");await c.verify();
  expect(deps.calls.length).toBe(calls);
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
