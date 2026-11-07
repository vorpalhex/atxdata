import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm,symlink,writeFile,readFile} from "node:fs/promises";
import {join} from "node:path";
import {Engine,sha} from "../src/engine";
import {Transport} from "../src/transport";
import {sources} from "../src/adapters";
import {fixturePdf} from "./engine.test";
async function temporary(action:(engine:Engine,root:string)=>Promise<void>) {
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"guard-test-"))),engine=await Engine.open(root);
 try {await action(engine,root);}finally {await engine.close();await rm(root,{recursive:true,force:true});}
}
test("writer collision, symlink artifact and immutable collision refuse changes",()=>temporary(async(engine,root)=>{
 await expect(Engine.open(root)).rejects.toThrow();
 const bytes=Buffer.from("safe");const path=join(root,`${sha(bytes)}.html`),sentinel=join(root,"sentinel");await writeFile(sentinel,"untouched");
 await symlink(sentinel,path);await expect(engine.artifact(bytes,"html")).rejects.toThrow("symlink");expect(await readFile(sentinel,"utf8")).toBe("untouched");
}));
test("verify rejects coordinated observation tampering and unbound history",()=>temporary(async engine=>{
 await engine.importPage("county-code",sources["county-code"].pages[0],`<a href="/two.pdf">Chapter 2</a>`,"test");
 const row=engine.list("county-code",{limit:1})[0]!;await engine.importPdf(row.id,fixturePdf(),"application/pdf","test");
 engine.db.run("UPDATE observations SET evidence=json_set(evidence,'$.chapter','3')");
 await expect(engine.verify("county-code",{limit:1})).rejects.toThrow("inventory mismatch");
}));
test("body interruption after headers leaves a durable stop gate",()=>temporary(async engine=>{
 let calls=0,now=10000;
 const transport=new Transport(engine,{fetch:async url=>{
  calls++;
  if(url.endsWith("robots.txt")) return new Response("User-agent: *\nDisallow:",{headers:{"Content-Type":"text/plain"}});
  return new Response(new ReadableStream({pull(controller){controller.error(new Error("body interrupted"));}}),{headers:{"Content-Type":"text/html"}});
 },sleep:async ms=>{now+=ms;},now:()=>now});
 await expect(transport.discover("budgets",sources.budgets.pages[0])).rejects.toThrow("body interrupted");
 const blocked=engine.db.query<{blocked:string|null},[]>("SELECT blocked FROM cooldowns WHERE id=1").get()!;
 expect(blocked.blocked).not.toBeNull();
 expect(calls).toBe(2);
}));
