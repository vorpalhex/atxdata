import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm,readFile} from "node:fs/promises";
import {join} from "node:path";
import {Engine,sha} from "../src/engine";
import {sources} from "../src/adapters";
import {fixturePdf} from "./engine.test";

const faults:Record<string,(e:Engine)=>void>={
 'receipt schema':e=>{
  const version=e.db.query<{validation:string;source:string;url:string;sha:string},[]>("SELECT * FROM versions").get()!;
  const receipt={...JSON.parse(version.validation),schema:999},text=JSON.stringify(receipt),hash=sha(text);
  e.db.run("INSERT INTO validation_history VALUES(?,?,?,?,?,?)",[version.source,version.url,version.sha,hash,text,new Date().toISOString()]);
  e.db.run("UPDATE versions SET validation=?",[text]);e.db.run("UPDATE history_receipts SET receipt_hash=?",[hash]);
 },
 'coordinated selected URL':e=>{
  e.db.exec('PRAGMA foreign_keys=OFF');
  e.db.run("UPDATE observations SET url='https://www.traviscountytx.gov/guessed.pdf',evidence=json_set(evidence,'$.url','https://www.traviscountytx.gov/guessed.pdf')");
  e.db.run("UPDATE versions SET url='https://www.traviscountytx.gov/guessed.pdf'");
  e.db.run("UPDATE history SET url='https://www.traviscountytx.gov/guessed.pdf'");
  e.db.run("UPDATE validation_history SET url='https://www.traviscountytx.gov/guessed.pdf'");
  e.db.exec('PRAGMA foreign_keys=ON');
 },
 'orphan version':e=>{e.db.run('DELETE FROM history_receipts');e.db.run('DELETE FROM history');},
 'missing snapshot metadata':e=>{e.db.run('DELETE FROM snapshot_metadata');},
};
for(const [name,fault] of Object.entries(faults)) test(`offline verify rejects ${name} without HTTP`,async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"corruption-test-"))),e=await Engine.open(root);
 try {
  await e.importPage('county-code',sources['county-code'].pages[0],'<a href="/2.pdf">Chapter 2 Code</a>','fixture');
  const row=e.list('county-code',{limit:1})[0]!;
  await e.importPdf(row.id,fixturePdf(),'application/pdf','fixture');
  expect(await e.verify('county-code',{chapter:'2',limit:1})).toMatchObject({httpRequests:0});
  fault(e);
  await expect(e.verify('county-code',{chapter:'2',limit:1})).rejects.toThrow();
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
