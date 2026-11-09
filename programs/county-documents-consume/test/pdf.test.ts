import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm} from "node:fs/promises";
import {join} from "node:path";
import {Engine,sha} from "../src/engine";
import {bodyEvidence,renderIdentity} from "../src/pdf";
import {fixturePdf} from "./engine.test";
import {sources} from "../src/adapters";

test("body dates separate fiscal, tax, amendment, report, attestation and publication unknown",()=>{
 expect(bodyEvidence('FISCAL YEAR 2027 TAX YEAR 2026 Proposed Budget')).toMatchObject({fiscalYear:"2027",taxYear:"2026",publicationDate:null});
 expect(bodyEvidence('Amended through October 21, 2025, Item 45')).toMatchObject({amendmentThroughOriginal:"October 21, 2025",amendmentThrough:"2025-10-21"});
 expect(bodyEvidence('Election Summary - 06/21/2022 11:39 AM')).toMatchObject({reportDateOriginal:"06/21/2022",reportDate:"2022-06-21",attestationDate:null});
 expect(bodyEvidence('Amendments added through August 16, 2022, Item #25.')).toMatchObject({amendmentThroughOriginal:"August 16, 2022",amendmentThrough:"2022-08-16"});
 expect(bodyEvidence('Chapter 464 was amended October 21, 2025, Item 45.')).toMatchObject({chapterAmendmentOriginal:"October 21, 2025",chapterAmendmentDate:"2025-10-21",amendmentThrough:null});
});
test("explicit bounded rendered review binds original, source, date and actual image",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"review-test-"))),engine=await Engine.open(root);
 try {
  await engine.importPage("election-documents",sources["election-documents"].pages[0],`<h2>2022 Official Results</h2><h3>June 11, 2022 Local Runoff Election</h3><a href="/r.pdf">Election Reconciliation – Official Totals</a>`,"fixture");
  const row=engine.list("election-documents",{date:"2022-06-11",limit:1})[0]!;
  const bytes=fixturePdf("");
  await expect(engine.importPdf(row.id,bytes,"application/pdf","fixture")).rejects.toThrow("rendered");
  const candidate=await engine.artifact(bytes,"candidate");
  const image=await renderIdentity(join(root,candidate.path),root);
  const review={documentSha256:sha(bytes),imageSha256:sha(image),county:"Travis",date:"2022-06-11",role:"reconciliation",state:"official",originalAttestationDate:"6.21.22",attestationDate:"2022-06-21",note:"Synthetic fixture manual review, not acquisition evidence"};
  await expect(engine.acceptRendered(row.id,bytes,image,{...review,date:"2022-06-12"})).rejects.toThrow();
  await engine.acceptRendered(row.id,bytes,image,review);
  expect(await engine.verify("election-documents",{date:"2022-06-11",limit:1})).toMatchObject({documents:1,httpRequests:0});
  const old=engine.db.query<{validation:string;source:string;url:string;sha:string},[]>("SELECT * FROM versions").get()!;
  const changed=JSON.parse(old.validation);changed.body.attestationDate="2030-01-01";
  const text=JSON.stringify(changed),hash=sha(text);
  engine.db.run("INSERT INTO validation_history VALUES(?,?,?,?,?,?)",[old.source,old.url,old.sha,hash,text,new Date().toISOString()]);
  engine.db.run("UPDATE versions SET validation=?",[text]);engine.db.run("UPDATE history_receipts SET receipt_hash=?",[hash]);
  await expect(engine.verify("election-documents",{limit:1})).rejects.toThrow("rendered body");
 }finally{await engine.close();await rm(root,{recursive:true,force:true});}
});
