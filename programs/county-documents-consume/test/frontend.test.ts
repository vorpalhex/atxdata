import {test,expect} from 'bun:test';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {run} from '../src/cli';

test('pure required operands, selection and review conflicts do not initialize archives',async()=>{
 const temp=await mkdtemp(join(process.env.TMPDIR!,'county-frontend-'));
 try {
  const cases=[['list'],['list','--source','invalid','--limit','1'],['list','--source','county-code','--limit','0'],['archive','--allow-network'],['import-page','--source','county-code'],['import-pdf'],['review-context'],['review-pdf','--observation','id','--input','pdf','--review','json','--image','one','--images','many']];
  for(const [index,args] of cases.entries()){
   const root=join(temp,String(index));
   await expect(run([...args,'--root',root])).rejects.toThrow();
   expect(await access(root).then(()=>true,()=>false)).toBe(false);
  }
  const root=join(temp,'valid');
  expect(await run(['status','--root',root])).toMatchObject({observations:0,attempts:0});
  expect(await access(join(root,'documents.sqlite')).then(()=>true,()=>false)).toBe(true);
 } finally {await rm(temp,{recursive:true,force:true});}
});
