import { expect, test } from "bun:test";
import { LegistarApiClient, normalizeItem } from "../../src/legistar/api-client";
import { loadConfig } from "../../src/config";
import { AppDatabase } from "../../src/storage/db";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
test("native Legistar CLI persists and resumes a capped collection", async () => {
  const folder=mkdtempSync(join(process.env.TMPDIR!,"legistar-pages-"));
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(req){
    const n=Number(new URL(req.url).searchParams.get("$skip")??0);
    return Response.json(n<3 ? [event(n+1)] : []);
  }});
  async function run(extra:string[]) {
    const child=Bun.spawn([process.execPath,"run","src/cli.ts","list-meetings-page","--from","2030-03-04","--to","2030-03-04","--page-size","5",...extra],{cwd:import.meta.dir+"/../..",env:{...process.env,DATA_PATH:join(folder,"data"),LEGISTAR_API_BASE:`${server.url}v1`,MAX_DOWNLOAD_RETRIES:"0"},stdout:"pipe",stderr:"pipe"});
    const error=await new Response(child.stderr).text(); expect({code:await child.exited,error}).toEqual({code:0,error:""});
    return JSON.parse(await new Response(child.stdout).text());
  }
  try {
    const first=await run(["--max-pages","2","--checkpoint",join(folder,"first.json")]);
    expect(first.complete).toBe(false); expect(first.meetings).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(folder,"first.json"),"utf8"))).toEqual(first);
    const final=await run(["--max-pages","2","--resume",join(folder,"first.json"),"--checkpoint",join(folder,"last.json")]);
    expect(final.complete).toBe(true); expect(final.meetings).toHaveLength(1);
  } finally {server.stop(true);}
});
const event = (EventId:number) => ({EventId,EventDate:"2030-03-04T00:00:00",EventBodyName:EventId%2 ? "Council":"Board"});
test("bare-array collection continues through server-capped short pages until empty", async () => {
  const calls: string[]=[];
  const api = new LegistarApiClient(loadConfig(), { async getJson<T>(url:string):Promise<T> {
    calls.push(url); const skip=Number(new URL(url).searchParams.get("$skip")??0);
    return Array.from({length:Math.min(2,Math.max(0,7-skip))},(_,i)=>event(skip+i+1)) as T;
  }, async fetchWithRetry(){throw new Error("unexpected");} });
  const first=await api.listEventsPage("2030-03-04","2030-03-04","Council",{maxPages:2,pageSize:5});
  expect(first.complete).toBe(false); expect(first.meetings.map(e=>e.eventId)).toEqual([1,3]);
  const last=await api.listEventsPage("2030-03-04","2030-03-04","Council",{maxPages:3,pageSize:5,continuation:JSON.parse(JSON.stringify(first.continuation))});
  expect(last.complete).toBe(true); expect(last.meetings.map(e=>e.eventId)).toEqual([5,7]); expect(calls).toHaveLength(5);
  expect(await api.listEvents("2030-03-04","2030-03-04",undefined,{maxPages:5,pageSize:5})).toHaveLength(7);
  const extraCursor={maxPages:5,pageSize:5,continuation:first.continuation};
  expect(await api.listEvents("2030-03-04","2030-03-04",undefined,extraCursor)).toHaveLength(7);
  await expect(api.listEvents("2030-03-04","2030-03-04",undefined,{maxPages:1,pageSize:5})).rejects.toThrow(/incomplete/);
});
test("requested agenda and minutes notes survive normalization and database reopening", async () => {
  const config=loadConfig(); config.databasePath=join(mkdtempSync(join(process.env.TMPDIR!,"notes-")),"archive.sqlite");
  const db=new AppDatabase(config); db.migrate();
  // Exercise the existing meeting writer using an actual normalized event.
  const meeting=await new LegistarApiClient(config,{async getJson<T>():Promise<T>{return event(1) as T;},async fetchWithRetry(){throw new Error("unexpected");}}).getEvent(1);
  db.upsertMeeting(meeting);
  db.upsertItem(normalizeItem({EventItemId:9,EventItemEventId:1,EventItemTitle:"Legacy row"}));
  db.db.run("ALTER TABLE meeting_items DROP COLUMN agenda_note");
  db.db.run("ALTER TABLE meeting_items DROP COLUMN minutes_note");
  db.migrate();
  expect(db.db.query("SELECT title FROM meeting_items").get()).toEqual({title:"Legacy row"});
  const item=normalizeItem({EventItemId:9,EventItemEventId:1,EventItemAgendaNote:"Agenda <p>note</p>",EventItemMinutesNote:""});
  expect(item).toMatchObject({agendaNote:"Agenda <p>note</p>",minutesNote:""});
  db.upsertItem(item);
  db.upsertItem(normalizeItem({EventItemId:9,EventItemEventId:1,EventItemTitle:"Old caller without notes"}));
  db.db.close();
  const reopened=new AppDatabase(config); reopened.migrate();
  expect(reopened.db.query("SELECT agenda_note,minutes_note FROM meeting_items").get()).toEqual({agenda_note:"Agenda <p>note</p>",minutes_note:""}); reopened.db.close();
});
