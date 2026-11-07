import { expect, test } from "bun:test";
import { mkdtemp, realpath, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Engine } from "../src/engine";
import { sources } from "../src/adapters";

export function fixturePdf(text = "Travis County Chapter 2 Code Interpretation") {
 const content=`BT /F1 12 Tf 10 100 Td (${text}) Tj ET`;
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
 let pdf="%PDF-1.4\n",offsets=[0];
 objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
 const start=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("")+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return Buffer.from(pdf);
}
test("retained discovery binds original URL, immutable versions, duplicate import and offline verify",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"documents-test-")));
 let engine: Engine|undefined;
 try {
  engine=await Engine.open(root);
  const page=sources["county-code"].pages[0];
  await engine.importPage("county-code",page,`<h2>Title 1</h2><a href="/two.pdf">Chapter 2 Code Interpretation</a>`,"retained-test");
  const rows=engine.list("county-code",{chapter:"2",limit:1});
  expect(rows).toHaveLength(1);
  const pdf=fixturePdf();
  await engine.importPdf(rows[0]!.id,pdf,"application/pdf","retained-test");
  await engine.importPdf(rows[0]!.id,pdf,"application/pdf","retained-test");
  expect(engine.status().versions).toBe(1);
  expect(await engine.verify("county-code",{chapter:"2",limit:1})).toMatchObject({documents:1,versions:1,httpRequests:0});
  const row=engine.db.query<{path:string},[]>("select path from versions").get()!;
  await writeFile(join(root,row.path),"tampered");
  await expect(engine.verify("county-code",{chapter:"2",limit:1})).rejects.toThrow();
 } finally {await engine?.close();await rm(root,{recursive:true,force:true});}
});
