import {test,expect,spyOn} from 'bun:test';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {main} from '../src/cli';
import {Collector} from '../src/collector';
import {hash,isoDate,sourceDate} from '../src/source';
import {fixture,multiReplay} from './multi-election.test';

test('date validation rejects rollover, timezone guesses and path input before HTTP',async()=>{
 await fixture(async(c,d)=>{
  for(const bad of ['2026-02-29','1900-02-29','2026-04-31','2026-13-01','0000-01-01','2026-00-01','2026-01-00','2026-1-03','2026-11-03T00:00:00Z','../2026-11-03'])await expect(c.collectDate(bad)).rejects.toThrow('calendar date');
  for(const good of ['0001-01-01','2000-02-29','2024-02-29','2026-11-03'])expect(isoDate(good)).toBe(good);
  expect(sourceDate('11/3/2026 12:00:00 AM')).toBe('2026-11-03');
  for(const bad of ['2/29/2026','11/3/2026 1:00:00 AM','2026-11-03'])expect(()=>sourceDate(bad)).toThrow();
  expect(d.calls).toEqual([]);
 });
});
test('ambiguous and nonexistent catalog dates identify candidates without fetching an election',async()=>{
 await fixture(async(c,d)=>{
  d.entries[0].Date=d.entries[1].Date;
  await expect(c.collectDate('2026-11-03')).rejects.toThrow('ambiguous catalog date 2026-11-03; candidates: 125662');
  expect(d.calls.length).toBe(4);expect(d.calls.some(u=>u.includes('current_ver'))).toBe(false);
  await expect(c.collectDate('2020-01-01')).rejects.toThrow('nonexistent catalog date 2020-01-01; candidates: 125662');
  expect(d.calls.length).toBe(4);
  await expect(c.collect('777777')).rejects.toThrow('absent from current catalog');
  expect(d.calls.some(u=>u.includes('/777777/'))).toBe(false);
 });
});
test('catalog date must bind settings and XML, not merely the election name',async()=>{
 await fixture(async(c,d)=>{
  d.entries[1].Date='11/4/2026 12:00:00 AM';
  await expect(c.collectDate('2026-11-04')).rejects.toThrow('identity mismatch');
 });
});
test('historic snapshot survives a legitimate later catalog metadata update; mutations still fail offline',async()=>{
 await fixture(async(c,d,root)=>{
  await c.collect('009876');d.entries[1].ElectionName='Updated catalog display label';
  d.entries[1].Date='11/4/2026 12:00:00 AM';await c.list();
  await c.verify();const calls=d.calls.length;
  await expect(c.collectDate('2026-11-04')).rejects.toThrow('cached snapshot date differs; use --refresh');
  expect(d.calls.length).toBe(calls);
  c.db.run("UPDATE elections SET event_date='11/5/2026' WHERE id='009876'");
  await expect(c.verify()).rejects.toThrow();
  c.db.run("UPDATE elections SET event_date=? WHERE id='009876'",[d.entries[1].Date]);
  await c.verify();
  const row=c.db.query<any,[]>("SELECT * FROM files WHERE name='catalog' ORDER BY rowid LIMIT 1").get()!;
  const path=join(root,row.path),raw=await readFile(path),entries=JSON.parse(raw.toString());entries[1].Date='11/5/2026 12:00:00 AM';
  const bad=Buffer.from(JSON.stringify(entries));await writeFile(path,bad);c.db.run('UPDATE files SET bytes=?,encoded_hash=?,decoded_hash=? WHERE id=?',[bad.length,hash(bad),hash(bad),row.id]);
  await expect(c.verify()).rejects.toThrow('identity mismatch');expect(d.calls.length).toBe(calls);
 });
});
test('resuming an older checkpoint does not roll back a later retained catalog index',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-resume-catalog-')),d=multiReplay();let stop=true;
 const c=await Collector.open(root,{...d,fetch:u=>{if(stop && u.endsWith('summary.json'))throw new Error('fixture stop');return d.fetch(u);}});
 try{
  await expect(c.collect('125662')).rejects.toThrow('fixture stop');
  d.entries[0].ElectionName='Updated display';await c.list();stop=false;
  await c.collect('125662');await c.verify();
  expect(c.db.query("SELECT label FROM elections WHERE id='125662'").get()).toEqual({label:'Updated display'});
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
test('CLI accepts catalog IDs and date, rejects invalid or competing selection before opening archive',async()=>{
 await fixture(async(_c,_d,root)=>{
  for(const args of [['--date','2026-02-29'],['--date','2026-11-03','--election','009876'],['--election','../009876']])await expect(main(['collect','--archive',join(root,'never-created'),...args])).rejects.toThrow();
 });
 const d=multiReplay();let clock=0;
 const fetch=spyOn(Bun,'fetch').mockImplementation(((url:any)=>d.fetch(String(url))) as typeof Bun.fetch);
 const now=spyOn(Date,'now').mockImplementation(()=>clock),sleep=spyOn(Bun,'sleep').mockImplementation((async(ms:any)=>{clock+=Number(ms);}) as typeof Bun.sleep);
 try{await fixture(async(_c,_d,root)=>{
  const target=join(root,'cli');
  expect(await main(['collect','--archive',target,'--date','2026-11-03'])).toMatchObject({reused:false});
  expect(await main(['sync','--archive',target,'--election','009876'])).toMatchObject({reused:true});expect(d.calls.length).toBe(12);
  await expect(main(['status','--archive',target,'--date','2026-11-03'])).rejects.toThrow();
 });}finally{fetch.mockRestore();now.mockRestore();sleep.mockRestore();}
});
