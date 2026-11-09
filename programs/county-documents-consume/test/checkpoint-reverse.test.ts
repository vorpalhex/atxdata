import {expect,test} from 'bun:test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Engine,sha} from '../src/engine';
import {sources} from '../src/adapters';
import {fixturePdf} from './engine.test';
for(const extension of ['wire','png','html']) test(`artifact read/reuse requires exact receipt or explicit evidenced prior ${extension}`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'legacy-receipt-'))),e=await Engine.open(root);
 try{
  const body=Buffer.from('retained prior artifact'),a=await e.artifact(body,extension);
  e.db.run('UPDATE artifact_checkpoints SET sha=? WHERE path=?',[sha('wrong expected hash'),a.path]);
  await expect(e.readArtifact(a.path)).rejects.toThrow('checkpoint');
  e.db.run('UPDATE artifact_checkpoints SET sha=? WHERE path=?',[a.hash,a.path]);
  e.db.run('UPDATE artifact_checkpoints SET bytes=0 WHERE path=?',[a.path]);
  await expect(e.readArtifact(a.path)).rejects.toThrow('checkpoint');
  e.db.run('DELETE FROM artifact_checkpoints WHERE path=?',[a.path]);
  await expect(e.artifact(body,extension)).rejects.toThrow('checkpoint');
  expect(e.db.query('SELECT 1 FROM artifact_checkpoints WHERE path=?').get(a.path)).toBeNull();
  e.db.run('INSERT INTO legacy_artifacts VALUES(?,?,?,?)',[a.path,a.hash,body.length,'{}']);
  await expect(e.readArtifact(a.path)).rejects.toThrow('evidence');
  const evidence={kind:'pre-checkpoint-artifact',path:a.path,sha:a.hash,bytes:body.length,priorArchiveSha256:sha('independent prior archive receipt'),reason:'x'};
  e.db.run('UPDATE legacy_artifacts SET evidence=?',[JSON.stringify({...evidence,reason:''})]);
  await expect(e.readArtifact(a.path)).rejects.toThrow('evidence');
  e.db.run('UPDATE legacy_artifacts SET evidence=?',[JSON.stringify(evidence)]);
  expect(await e.readArtifact(a.path)).toEqual(body);
  expect(e.db.query('SELECT 1 FROM artifact_checkpoints WHERE path=?').get(a.path)).toBeNull();
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
for(const extension of ['html','pdf','candidate']) test(`required ${extension} artifact cannot lose its promotion checkpoint`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'checkpoint-reverse-'))),e=await Engine.open(root);
 try{
  await e.importPage('county-code',sources['county-code'].pages[0],'<a href="/2.pdf">Chapter 2</a>','fixture');
  await e.importPdf(e.list('county-code',{limit:1})[0]!.id,fixturePdf(),'application/pdf','fixture');
  await e.verify('county-code',{chapter:'2',limit:1});
  const row=e.db.query<{path:string},[string]>("SELECT path FROM artifact_checkpoints WHERE path LIKE ?").get('%.'+extension)!;
  e.db.run('DELETE FROM artifact_checkpoints WHERE path=?',[row.path]);
  await expect(e.verify('county-code',{chapter:'2',limit:1})).rejects.toThrow('checkpoint');
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
