import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm,symlink,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {run} from "../src/cli";
import {sources} from "../src/adapters";
test("CLI imports exact header evidence and rejects both resolving and dangling input symlinks",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"cli-headers-")));
 try {
  const html=join(root,"input.html"),headers=join(root,"input.headers");
  await writeFile(html,'<a href="/2.pdf">Chapter 2</a>');
  await writeFile(headers,'HTTP/2 200\r\nX-Robots-Tag: noindex, noarchive\r\n');
  const args=['import-page','--root',root,'--source','county-code','--page',sources['county-code'].pages[0],'--input',html,'--origin','retained','--headers',headers];
  expect(await run(args)).toMatchObject({occurrences:1});
  for(const target of [headers,join(root,"missing")]) {
   const link=join(root,crypto.randomUUID()+".headers");await symlink(target,link);
   await expect(run([...args.slice(0,-1),link])).rejects.toThrow("symlink");
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
