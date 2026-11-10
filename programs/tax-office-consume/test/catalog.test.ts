import {test,expect} from 'bun:test';import {run} from '../src/cli';
import {parseCatalog} from '../src/catalog';
import {Collector} from '../src/collector';import {join} from 'node:path';import {writeFile,rm} from 'node:fs/promises';import {temp} from './collector.test';
const html='<h3>Tax Rolls</h3><a href="/voterdata/TaxDelqOpenData.csv">Tax Delinquent, CSV</a><a href="/voterdata/TaxCurOpenData.csv">Tax Current Year and Prior Year Delinquent, CSV</a><a href="/voterdata/TaxCurOpenData.zip">Tax Current Year and Prior Year Delinquent, Excel zip</a><h3>Table Definitions</h3><a href="/pages/CurrentFileLayout.php">Tax Current Year and Prior Year Delinquent File Layout</a><a href="/pages/DelinquentFileLayout.php">Tax Delinquent File Layout</a><!--<a href="/voterdata/TaxCurOpenData_NEW.csv">not published</a>-->';
test('catalog-selected raw export CLI binds current layout, preserves independent versions, and does not apply delinquency money semantics',async()=>{
 const base=await temp(),output=join(base,'archive'),file=join(base,'current.csv'),layout=join(base,'current-layout'),page=join(base,'property.html');
 await writeFile(page,html);await writeFile(file,'Account,Not Money\r\n00000000000001,arbitrary text\r\n');await writeFile(layout,'retained current layout bytes; raw not semantic PDF validation');
 try{
  const catalog=await run(['catalog-import','--output',output,'--html',page]) as {items:{id:string;layout:string|null;profile:string}[]};
  expect(catalog.items).toHaveLength(5);expect(catalog.items.find(i=>i.id==='/voterdata/TaxCurOpenData.csv')).toMatchObject({layout:'https://tax-office.traviscountytx.gov/pages/CurrentFileLayout.php',profile:'raw-original'});
  const args=['import-export','--output',output,'--selection','/voterdata/TaxCurOpenData.csv','--file',file,'--layout',layout,'--max-bytes','10000'];
  const child=Bun.spawn([process.execPath,join(import.meta.dir,'../src/cli.ts'),...args],{stdout:'pipe',stderr:'pipe'});const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(stderr).toBe('');expect(exit).toBe(0);expect(JSON.parse(stdout)).toMatchObject({rows:null,profile:'raw-original',reused:false});
  expect(await run(args)).toMatchObject({reused:true});await writeFile(file,'Account,Not Money\r\n00000000000002,new version\r\n');expect(await run(args)).toMatchObject({reused:false});
  expect(await run(['verify','--output',output])).toMatchObject({exports:2,httpRequests:0});
  const c=await Collector.open(output);try{c.db.run("UPDATE artifacts SET url='https://tax-office.traviscountytx.gov/pages/DelinquentFileLayout.php' WHERE kind='layout'");await expect(c.verify()).rejects.toThrow('export artifact');}finally{await c.close();}
 }finally{await rm(base,{recursive:true,force:true});}
});
test('catalog preserves native format, rejects ambiguous labels and excludes unsafe or unlabeled routes',()=>{
 const base='<a href="/voterdata/good.csv">Good CSV</a>';
 expect(parseCatalog(base)[0]).toMatchObject({format:'csv'});
 expect(parseCatalog('<a href="/pages/Rates.php">Rates</a>')[0]).toMatchObject({format:'php'});
 for(const href of ['https://u@tax-office.traviscountytx.gov/voterdata/bad.csv','https://:fixture@tax-office.traviscountytx.gov/voterdata/bad.csv','/voterdata/bad.csv#fragment','/voterdata/bad%2fescape.csv','/pages/Unrelated.php'])expect(parseCatalog(base+`<a href="${href}">Unrelated</a>`)).toHaveLength(1);
 expect(()=>parseCatalog(base+'<a href="/voterdata/good.csv">Conflicting CSV</a>')).toThrow('ambiguous');
 expect(parseCatalog(base+base)).toHaveLength(1);
});
