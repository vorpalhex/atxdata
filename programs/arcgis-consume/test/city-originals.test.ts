import {test,expect} from "bun:test";
import {readFile,mkdtemp} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {main} from "../src/cli";
import {terms} from "../src/rules";
const manifest=process.env.ARCGIS_CITY_INPUTS;
(manifest?test:test.skip)("retained actual Austin originals collect, verify and reuse through CLI dispatch without public requests",async()=>{
 const inputs=JSON.parse(await readFile(manifest!,"utf8"));
 const responses=new Map<string,Array<{status:number;bytes:Buffer}>>();
 const key=(url:string)=>{const u=new URL(url);u.searchParams.sort();return u.href;};
 for(const input of inputs.responses) {
  const bytes=await readFile(input.path);
  expect(bytes.length).toBe(input.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(input.sha256);
  const k=key(input.url); responses.set(k,[...(responses.get(k)??[]),{status:input.status,bytes}]);
 }
 let now=0,calls=0;const used=new Map<string,number>();
 const deps={now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetch:async(url:string)=>{
  const k=key(url),i=used.get(k)??0,response=responses.get(k)?.[i];
  if(!response)throw Error("missing retained response");
  calls++;used.set(k,i+1);
  return new Response(new Uint8Array(response.bytes),{status:response.status});
 }};
 const root=await mkdtemp(join(process.env.TMPDIR!,"city-original-"));
 const metadata=JSON.parse(await readFile(inputs.itemMetadata,"utf8"));
 const args=["collect","--source","austin","--item",metadata.id,"--layer",String(inputs.layer),"--fields",inputs.fields.join(","),"--archive",root,"--terms-sha256",terms(metadata).sha256,"--max-records","100","--response-bytes","2097152","--max-bytes","20971520"];
 const result:any=await main(args,deps),before=calls;
 expect(result.summary.records).toBe(inputs.records);
 expect(result.summary.sourcePolicy.unavailable[0].status).toBe(403);
 expect((await main(args,deps) as any).reused).toBe(true);
 expect((await main(["verify","--archive",root],deps) as any).collections).toBe(1);
 expect(calls).toBe(before);
});
