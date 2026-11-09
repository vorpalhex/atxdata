import {test,expect} from 'bun:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Collector} from '../src/collector';
import {HEADER} from '../src/source';
export function sample(){const row=HEADER.map(()=>'');Object.assign(row,{0:'00000000000001',1:'2025',3:'0',4:'0',5:'0',6:'0',7:'0',8:'0',10:'0.10',11:'0.20',12:'0.30',13:'1'});return Buffer.from(HEADER.join(',')+'\r\n'+row.join(',')+'\r\n');}
import {validPdf} from './fixture';
export const pdf=validPdf();
export async function temp(){return mkdtemp(join(process.env.TMPDIR!,'tax-test-'));}
test('imports two retained artifacts with versioned rows, reuses without HTTP and verifies identities',async()=>{
 const base=await temp(),root=join(base,'archive');await writeFile(join(base,'input.csv'),sample());await writeFile(join(base,'layout.pdf'),pdf);
 const c=await Collector.open(root,{fetch:async()=>{throw new Error('NO HTTP');}});
 try{
  const first=await c.importRetained('delinquency',{csv:join(base,'input.csv'),layout:join(base,'layout.pdf'),maxRows:1});expect(first.rows).toBe(1);expect(first.reused).toBe(false);
  expect((await c.importRetained('delinquency',{csv:join(base,'input.csv'),layout:join(base,'layout.pdf'),maxRows:1})).reused).toBe(true);
  expect(await c.verify()).toEqual({snapshots:1,rows:1,httpRequests:0});
  c.db.run("UPDATE rows SET account='changed'");await expect(c.verify()).rejects.toThrow('row provenance');
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
test('lone artifact cannot complete and failed attempt remains recoverable',async()=>{
 const base=await temp(),c=await Collector.open(join(base,'archive'));await writeFile(join(base,'input.csv'),sample());
 try{
  await expect(c.importRetained('delinquency',{csv:join(base,'input.csv'),layout:join(base,'missing.pdf'),maxRows:1})).rejects.toThrow();
  expect(c.status().complete).toBe(0);expect(c.status().failed).toBe(1);
  await writeFile(join(base,'layout.pdf'),pdf);await c.importRetained('delinquency',{csv:join(base,'input.csv'),layout:join(base,'layout.pdf'),maxRows:1});expect((await c.verify()).snapshots).toBe(1);
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
