import {expect,test} from 'bun:test';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {run} from '../src/cli';
import {sources} from '../src/adapters';
import {fixturePdf} from "./engine.test";
import {authoredLargePdf} from "./fixtures";

test('CLI exposes common operation and PDF budgets without requiring network for import',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'cli-budgets-')));
 try {
  const page=join(root,'input.html'),pdf=join(root,'input.pdf');
  await writeFile(page,'<a href="/big.pdf">Chapter 2</a>');
  const bytes=authoredLargePdf();await writeFile(pdf,bytes);
  await run(['import-page','--root',root,'--source','county-code','--page',sources['county-code'].pages[0],'--input',page,'--origin','authored']);
  const row=(await run(['list','--root',root,'--source','county-code','--limit','1']) as {id:string}[])[0]!;
  const args=['import-pdf','--root',root,'--observation',row.id,'--input',pdf,'--origin','authored'];
  await expect(run([...args,'--max-pdf-bytes','1024'])).rejects.toThrow('byte limit');
  await expect(run([...args,'--max-bytes','1024'])).rejects.toThrow('byte limit');
  expect(await run([...args,'--max-pdf-bytes',String(bytes.length),'--max-bytes','10000000','--max-requests','20','--max-pages','10'])).toHaveProperty('hash');
  expect(await run(['verify','--root',root,'--source','county-code','--limit','1'])).toMatchObject({documents:1});
  for(const value of ['0','-1','1junk','NaN','9007199254740992']) await expect(run([...args,'--max-pdf-bytes',value])).rejects.toThrow('budget');
 }finally {await rm(root,{recursive:true,force:true});}
});
