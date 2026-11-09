import {expect,test} from "bun:test";
import {mkdtemp,realpath,rm} from "node:fs/promises";
import {join} from "node:path";
import {Engine} from "../src/engine";
import {Transport} from "../src/transport";
import {sources} from "../src/adapters";
test("one archive's durable start gate also refuses overlapping transport instances",async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,"shared-gate-"))),e=await Engine.open(root);
 let active=0,maximum=0,now=10000;
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  active++;maximum=Math.max(maximum,active);await Bun.sleep(5);active--;
  return url.endsWith('robots.txt')?new Response('User-agent: *\nDisallow:',{headers:{'Content-Type':'text/plain'}}):new Response('<h1>FY 2031</h1><a href="/i.pdf">Taxpayer Impact Statement</a>',{headers:{'Content-Type':'text/html'}});
 }};
 try {
  const first=new Transport(e,deps),second=new Transport(e,deps);
  const results=await Promise.allSettled([first.discover('budgets',sources.budgets.pages[0]),second.discover('budgets',sources.budgets.pages[1])]);
  expect(maximum).toBe(1);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 }finally{await e.close();await rm(root,{recursive:true,force:true});}
});
