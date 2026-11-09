import { expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { CivicClerkClient } from "../src/client";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
const evidence = process.env.MEETINGS_EVIDENCE ?? process.env.TMPDIR!;
test("reports unsupported published classes rather than silently claiming full acquisition", async () => {
  const unsupported={fileId:8,fileType:9,type:"Unverified media",name:"Other"};
  const api=new CivicClerkClient({async getJson<T>():Promise<T>{return {id:654,eventName:"Fixture",eventDate:"2030-03-04T00:00:00Z",publishedFiles:[unsupported]} as T;},async request<T>():Promise<T>{throw new Error("unexpected");}});
  const result=await api.downloadEvent(654,mkdtempSync(join(evidence,"unsupported-")));
  expect(result).toMatchObject({downloaded:0,skipped:0,unsupportedFiles:[unsupported]});
  await expect(api.downloadEvent(654,"unused",{fileTypes:[9]})).rejects.toThrow(/unsupported/);
  for (const type of [1,2,4,5]) expect(await api.downloadEvent(654,mkdtempSync(join(evidence,"supported-selection-")),{fileTypes:[type]})).toMatchObject({downloaded:0,skipped:0});
});
test("bounded listing persists continuation and completes beyond twenty pages", async () => {
  const calls: string[] = [];
  const api = new CivicClerkClient({ async getJson<T>(url: string): Promise<T> {
    calls.push(url); const page = Number(new URL(url).searchParams.get("$skip") ?? 0);
    return { value: [{ id: page+1, eventName: "Fixture", eventDate: "2030-03-04T00:00:00Z", publishedFiles: [] }], "@odata.count": 23, ...(page<22 ? { "@odata.nextLink": `?$skip=${page+1}` } : {}) } as T;
  }, async request<T>(): Promise<T> { throw new Error("unexpected"); } }, "https://example.test/v1/");
  const first = await api.listEventsPage("2030-03-04", "2030-03-04", { maxPages: 20 });
  expect(first.complete).toBe(false); expect(first.events).toHaveLength(20);
  const state = JSON.parse(JSON.stringify(first.continuation));
  const final = await api.listEventsPage("2030-03-04", "2030-03-04", { maxPages: 3, continuation: state });
  expect(final.complete).toBe(true); expect(final.events.map(e=>e.id)).toEqual([21,22,23]);
  expect(calls).toHaveLength(23);
  expect(await api.listEvents("2030-03-04", "2030-03-04", { maxPages: 30 })).toHaveLength(23);
  const extraCursor={maxPages:30,continuation:state};
  expect(await api.listEvents("2030-03-04","2030-03-04",extraCursor)).toHaveLength(23);
  await expect(api.listEventsPage("2030-03-04", "2030-03-04", { continuation: {...state, next: "https://evil.test/v1/Events?$skip=20"} })).rejects.toThrow(/pagination|continuation/);
});
test("in-process CLI checkpoints persist, resume and refuse completed or clobbered output", async () => {
  const folder=mkdtempSync(join(evidence,"in-process-pages-"));
  let calls=0;
  const api=new CivicClerkClient({async getJson<T>(url:string):Promise<T>{
    calls++; return {value:new URL(url).searchParams.has("$skip") ? [] : [{id:1,eventName:"Fixture",eventDate:"2030-03-04T00:00:00Z",publishedFiles:[]}], ...(new URL(url).searchParams.has("$skip") ? {} : {"@odata.nextLink":"?$skip=1"}), "@odata.count":1} as T;
  },async request<T>():Promise<T>{throw new Error("unexpected");}},"https://example.test/v1/");
  const args=["list-meetings","--from","2030-03-04","--to","2030-03-04","--max-pages","1"];
  const first=join(folder,"first.json"),last=join(folder,"last.json"); const lines:string[]=[];
  await runCli([...args,"--checkpoint",first],api,line=>lines.push(line));
  expect(JSON.parse(readFileSync(first,"utf8"))).toEqual(JSON.parse(lines[0]!));
  expect(JSON.parse(lines[0]!).complete).toBe(false);
  await runCli([...args,"--resume",first,"--checkpoint",last],api,line=>lines.push(line));
  expect(JSON.parse(readFileSync(last,"utf8")).complete).toBe(true); expect(calls).toBe(2);
  await expect(runCli([...args,"--checkpoint",first],api)).rejects.toThrow();
  await expect(runCli([...args,"--resume",last,"--checkpoint",join(folder,"unused.json")],api)).rejects.toThrow(/completed/);
  await expect(runCli([...args,"--resume",first],api)).rejects.toThrow(/requires/); expect(calls).toBe(2);
});
test("native listing CLI persists bounded batches and resumes without silent truncation", async () => {
  const folder = mkdtempSync(join(evidence, "listing-"));
  let calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const n = Number(new URL(req.url).searchParams.get("$skip") ?? 0); calls++;
    return Response.json({ value: [{ id:n+1, eventName:"Fixture", eventDate:"2030-03-04T00:00:00Z", publishedFiles:[] }], "@odata.count":23, ...(n<22 ? {"@odata.nextLink":`?$skip=${n+1}`} : {}) });
  }});
  async function run(extra: string[]) {
    const child = Bun.spawn([process.execPath,"run","src/cli.ts","list-meetings","--from","2030-03-04","--to","2030-03-04",...extra], {cwd:import.meta.dir+"/..",env:{...process.env,CIVICCLERK_API_BASE:`${server.url}v1/`,HTTP_MIN_INTERVAL_MS:"0",HTTP_MAX_RETRIES:"0"},stdout:"pipe",stderr:"pipe"});
    const error = await new Response(child.stderr).text();
    expect({code:await child.exited,error}).toEqual({code:0,error:""});
    return JSON.parse(await new Response(child.stdout).text());
  }
  try {
    const first = await run(["--max-pages","20","--checkpoint",join(folder,"first.json")]);
    expect(first.complete).toBe(false); expect(first.events).toHaveLength(20);
    expect(JSON.parse(readFileSync(join(folder,"first.json"),"utf8"))).toEqual(first);
    const final = await run(["--max-pages","3","--resume",join(folder,"first.json"),"--checkpoint",join(folder,"final.json")]);
    expect(final.complete).toBe(true); expect(final.events).toHaveLength(3); expect(calls).toBe(23);
  } finally { server.stop(true); }
});
test("native CLI can raise the combined byte budget for a packet above 12 MiB", async () => {
  const archive = mkdtempSync(join(evidence, "large-packet-"));
  const bytes = Buffer.alloc(13 * 1024 * 1024, 32); bytes.write("%PDF-1.7\n");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    if (new URL(req.url).pathname.endsWith("/Events/987")) return Response.json({ id: 987, eventName: "Authored fixture", eventDate: "2030-03-04T00:00:00Z", publishedFiles: [{ fileId: 222, fileType: 2, type: "Packet", name: "Large" }] });
    return new Response(bytes, { headers: { "content-type": "application/pdf" } });
  }});
  try {
    const child = Bun.spawn([process.execPath, "run", "src/cli.ts", "ingest-meeting", "--event-id", "987", "--output", archive, "--max-bytes", String(14*1024*1024), "--max-documents", "1", "--file-types", "2"], { cwd: import.meta.dir+"/..", env: { ...process.env, CIVICCLERK_API_BASE: `${server.url}v1/`, HTTP_MIN_INTERVAL_MS: "0", HTTP_MAX_RETRIES: "0" }, stdout: "pipe", stderr: "pipe" });
    const stderr = await new Response(child.stderr).text();
    expect({ code: await child.exited, stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(await new Response(child.stdout).text())).toMatchObject({ downloaded: 1, skipped: 0 });
    expect(statSync(join(archive, "event-987/type-2_file-222_large.pdf")).size).toBe(bytes.length);
  } finally { server.stop(true); }
});
test("CLI rejects invalid budgets and unsupported requested file classes before work", async () => {
  const api = { async listEvents(){ return []; }, async downloadEvent(){ throw new Error("unexpected work"); } };
  for (const [key,value] of [["max-bytes","-1"],["max-documents","1.5"],["max-bytes","9007199254740992"],["file-types","9"]]) {
    await expect(runCli(["ingest-meeting","--event-id","987","--output","unused",`--${key}=${value}`],api)).rejects.toThrow(/invalid|unsupported/);
  }
});
