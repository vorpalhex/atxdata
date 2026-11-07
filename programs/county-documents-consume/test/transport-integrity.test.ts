import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm} from "node:fs/promises";
import {join} from "node:path";
import {Engine} from "../src/engine";
import {Transport} from "../src/transport";
import {sources} from "../src/adapters";
import {verifySchema} from "../src/schema";
import {verifyRepresentations} from "../src/archive-verification";

async function scope(action:(e:Engine)=>Promise<void>) {
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"transport-integrity-"))),e=await Engine.open(root);
 try{await action(e);}finally{await e.close();await rm(root,{recursive:true,force:true});}
}
for(const table of ['robots','representations','classifier_resolutions']) test(`fresh offline schema owns ${table}; loss refuses transport`,()=>scope(async e=>{
 expect(e.db.query("SELECT 1 FROM sqlite_master WHERE name=?").get(table)).not.toBeNull();
 e.db.exec(`DROP TABLE ${table}`);
 expect(()=>new Transport(e)).toThrow('schema');
 expect(e.db.query("SELECT 1 FROM sqlite_master WHERE name=?").get(table)).toBeNull();
}));
for(const [table,column] of [['robots','delay'],['representations','encoding'],['classifier_resolutions','reason']]) test(`transport schema requires ${table}.${column}`,()=>scope(async e=>{
 e.db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
 expect(()=>verifySchema(e.db)).toThrow('schema');
}));
const faults=[
 "DELETE FROM representations",
 "UPDATE attempts SET bytes=0,sha='broken'",
 "UPDATE attempts SET status=503,error=NULL",
 "UPDATE attempts SET status=NULL,error='Error: interrupted'; UPDATE cooldowns SET blocked='failed attempt requires review'",
 "UPDATE attempts SET reservation=1",
 "UPDATE representations SET representation='unknown'",
 "INSERT INTO classifier_resolutions SELECT id,1,'gate','reason',sha FROM attempts LIMIT 1",
];
for(const sql of faults) test(`transport integrity rejects ${sql}`,()=>scope(async e=>{
 let now=10000;
 const t=new Transport(e,{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async url=>new Response(url.endsWith('robots.txt')?'User-agent: *\nDisallow:':'<h2>FY 2030</h2><a href="/tax.pdf">Taxpayer Impact Statement</a>',{headers:{'content-type':url.endsWith('robots.txt')?'text/plain':'text/html'}})});
 await t.discover('budgets',sources.budgets.pages[0]);
 await verifyRepresentations(e);
 e.db.exec(sql);
 await expect(verifyRepresentations(e)).rejects.toThrow();
 let calls=0;
 const next=new Transport(e,{fetch:async()=>{calls++;throw Error('must not fetch');}});
 await expect(next.discover('budgets',sources.budgets.pages[1])).rejects.toThrow();
 expect(calls).toBe(0);
}));
test('no-body failed/inflight attempts require full reservation and stop',()=>scope(async e=>{
 const run=e.start('budgets','page');
 e.db.run("INSERT INTO attempts(id,run,url,kind,started,reservation) VALUES('unfinished',?,?, 'page',1,3145728)",[run,sources.budgets.pages[0]]);
 await expect(verifyRepresentations(e)).rejects.toThrow();
 e.db.exec("UPDATE cooldowns SET blocked='unfinished attempt requires operator review'");
 await verifyRepresentations(e);
 e.db.exec("UPDATE attempts SET ended=2,error='Error: interrupted'");
 await verifyRepresentations(e);
 e.db.exec("UPDATE attempts SET reservation=0");
 await expect(verifyRepresentations(e)).rejects.toThrow();
}));
