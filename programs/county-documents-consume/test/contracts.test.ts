import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {Engine,sha} from "../src/engine";
import {sources} from "../src/adapters";
import {fixturePdf} from "./engine.test";
async function scope(action:(e:Engine,root:string)=>Promise<void>) {
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"contract-test-")));
 const engine=await Engine.open(root);
 try{await action(engine,root);}finally{await engine.close();await rm(root,{recursive:true,force:true});}
}
test("source aggregate link cap applies across pages, not separately to each",()=>scope(async e=>{
 const links=(n:number)=>'<h2>FY 2030</h2>'+Array.from({length:n},(_,i)=>`<a href="/${i}.pdf">Taxpayer Impact Statement</a>`).join('');
 await e.importPage("budgets",sources.budgets.pages[0],links(1001),"fixture");
 await expect(e.importPage("budgets",sources.budgets.pages[2],links(1000),"fixture")).rejects.toThrow("aggregate");
 expect(e.status().snapshots).toBe(1);
}));
test("history binds both directions including unselected observation identity and receipt hash",()=>scope(async e=>{
 await e.importPage("county-code",sources["county-code"].pages[0],'<a href="/2.pdf">Chapter 2</a><a href="/3.pdf">Chapter 3</a>',"fixture");
 const rows=e.list("county-code",{limit:2});
 for(const row of rows)await e.importPdf(row.id,fixturePdf(`Travis County Chapter ${row.chapter}`),"application/pdf","fixture");
 const selected=rows.find(r=>r.chapter==="2")!,other=rows.find(r=>r.chapter==="3")!;
 e.db.exec("PRAGMA foreign_keys=OFF");
 e.db.run("UPDATE history SET observation=? WHERE observation=?",[selected.id,other.id]);
 e.db.run("UPDATE history_receipts SET observation=? WHERE observation=?",[selected.id,other.id]);
 e.db.exec("PRAGMA foreign_keys=ON");
 await expect(e.verify("county-code",{chapter:"2",limit:1})).rejects.toThrow("history");
}));
test("saved headers retain publisher instructions and unknown observation timestamp explicitly",()=>scope(async e=>{
 const headers='HTTP/2 200\r\nContent-Type: text/html\r\nX-Robots-Tag: noindex, noarchive\r\n';
 const result=await e.importPage("county-code",sources["county-code"].pages[0],'<a href="/2.pdf">Chapter 2</a>',"retained",headers);
 const meta=e.db.query<{headers:string;original_retrieved_at:null},[string]>("SELECT * FROM snapshot_metadata WHERE snapshot=?").get(result.snapshot)!;
 expect(meta.headers).toBe(headers);expect(meta.original_retrieved_at).toBeNull();
 e.db.run("DELETE FROM observations WHERE snapshot=?",[result.snapshot]);
 await expect(e.verify("county-code",{limit:1})).rejects.toThrow();
}));
test("incomplete checkpoint and missing existing schema fail closed on reopen",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"restart-test-")));
 let e=await Engine.open(root);
 try {
  e.db.run("INSERT INTO artifact_checkpoints VALUES(?,?,?,?,?)",[sha("x")+".html",sha("x"),1,"writing","owned.part"]);
  await e.close();
  await expect(Engine.open(root)).rejects.toThrow("checkpoint");
 }finally{await rm(root,{recursive:true,force:true});}
 const other=await realpath(await mkdtemp(join(process.env.TMPDIR!,"schema-test-")));
 e=await Engine.open(other);e.db.run("DROP TABLE snapshots");await e.close();
 try{await expect(Engine.open(other)).rejects.toThrow("schema");}finally{await rm(other,{recursive:true,force:true});}
});
