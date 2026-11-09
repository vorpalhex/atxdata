import {expect,test} from 'bun:test';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Engine,sha} from '../src/engine';
import {sources} from '../src/adapters';
import {run} from '../src/cli';
import * as pdf from '../src/pdf';
const {renderIdentity}=pdf;

export function twoPagePdf() {
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] >>'];
 let pdf='%PDF-1.4\n';const offsets:number[]=[];
 for(const [index,object] of objects.entries()) {offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
 const start=pdf.length;pdf+='xref\n0 5\n0000000000 65535 f \n'+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return Buffer.from(pdf);
}
test('explicit multipage review binds each selected physical page, image and complete selection, legacy API retained',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'multipage-')));
 let engine=await Engine.open(root),closed=false;
 try {
  expect(typeof pdf.reviewSelectionHash).toBe('function');
  await engine.importPage('budgets',sources.budgets.pages[0],'<h1>FY 2034</h1><a href="/a.pdf">Adopted Budget</a>','authored');
  const row=engine.list('budgets',{limit:1})[0]!,bytes=twoPagePdf();
  await expect(engine.importPdf(row.id,bytes,'application/pdf','authored')).rejects.toThrow('rendered');
  const candidate=await engine.artifact(bytes,'candidate');
  const images=[await renderIdentity(join(root,candidate.path),root,1),await renderIdentity(join(root,candidate.path),root,2)];
  const review={schema:1 as const,documentSha256:sha(bytes),selectionSha256:pdf.reviewSelectionHash(row),county:'Travis',pages:images.map((image,index)=>({page:index+1,imageSha256:sha(image),note:'Authored blank fixture only, not a real source identity assertion'})),note:'Test-only explicit assertion',originalAttestationDate:null,attestationDate:null};
  await expect(engine.acceptRenderedPages(row.id,bytes,images,{...review,selectionSha256:'0'.repeat(64)})).rejects.toThrow('selection');
  await expect(engine.acceptRenderedPages(row.id,bytes,images,{...review,pages:[{...review.pages[0]!,page:3}]})).rejects.toThrow();
  await expect(engine.acceptRenderedPages(row.id,bytes,images,{...review,pages:[review.pages[0]!,review.pages[0]!]})).rejects.toThrow();
  await engine.acceptRenderedPages(row.id,bytes,images,review);
  expect(await engine.verify('budgets',{year:'2034',limit:1})).toMatchObject({documents:1});
  const stored=engine.db.query<{validation:string},[]>('SELECT validation FROM versions').get()!;
  expect(JSON.parse(stored.validation)).toMatchObject({quality:'reviewed-pages-visual-identity',review:{selectionSha256:pdf.reviewSelectionHash(row)}});
  await writeFile(join(root,'input.pdf'),bytes);
  for(const [index,image] of images.entries()) await writeFile(join(root,`page-${index+1}.png`),image);
  await writeFile(join(root,'images.json'),JSON.stringify(images.map((_,index)=>join(root,`page-${index+1}.png`))));
  await writeFile(join(root,'review.json'),JSON.stringify(review));
  await engine.close();
  closed=true;
  expect(await run(['review-context','--root',root,'--observation',row.id])).toMatchObject({selectionSha256:pdf.reviewSelectionHash(row)});
  expect(await run(['review-pdf','--root',root,'--observation',row.id,'--input',join(root,'input.pdf'),'--images',join(root,'images.json'),'--review',join(root,'review.json')])).toHaveProperty('hash');
  // Reopen for the existing finally owner.
  engine=await Engine.open(root);closed=false;
 }finally {if(!closed) await engine.close();await rm(root,{recursive:true,force:true});}
});
