import { expect, test } from "bun:test";
import { CivicClerkClient } from "../src/client";
import { PoliteHttpClient } from "../src/http";
const base = "https://example.test/v1/";
const badLinks = [
  "Meetings/GetMeetingFileStream(fileId=158,plainText=false)", "Media/Stream", "Events/59", "Events/Export", "Events/Action()",
  "Meetings/GetMeetingFileStream(fileId=158,plainText=false)?$skip=1", "Media/Stream?$skip=1", "Events/59?$skip=1", "Events/Export?$skip=1", "Events/Action()?$skip=1",
  "https://elsewhere.test/v1/Events?$skip=1", "https://u:p@example.test/v1/Events?$skip=1", "https://:p@example.test/v1/Events?$skip=1",
  "Events?$skip=1#part", "Events?$skip=1#", "../v1/Events?$skip=1", "Events/../Events?$skip=1", "/v1/./Events?$skip=1",
  "/v1/%2e/Events?$skip=1", "/v1/%45vents?$skip=1", "/v1/Events%2f59?$skip=1", "Events\\..\\Events?$skip=1",
  "Events/?$skip=1", "Events?$expand=publishedFiles&$skip=1", "Events?$select=id&$skip=1", "Events?$orderby=id&$skip=1",
  "Events?fileId=158&$skip=1", "Events?plainText=false&$skip=1", "Events?$format=application/pdf&$skip=1",
  "Events?$skip=1&$skip=2", "Events?$skip=1&%24skip=2", "Events?$top=25&$top=500&$skip=1",
  "Events?$filter=x&$filter=y&$skip=1", "Events?$count=true&$count=true&$skip=1", "Events?$skiptoken=a&$skiptoken=b",
  "Events?$skip=1&$skiptoken=a", "Events", "Events?$top=25", "Events?$skip=NaN", "Events?$skip=Infinity",
  "Events?$skip=-1", "Events?$skip=0", "Events?$skip=1.5", "Events?$skip=01", "Events?$skip=9007199254740992",
  "Events?$skiptoken=", "Events?$skiptoken=%20", "Events?$skiptoken=%0a", `Events?$skiptoken=${"x".repeat(4097)}`,
];
for (const [index, next] of badLinks.entries()) test(`refuses unsafe continuation ${index} before transport`, async () => {
  const calls: string[] = [];
  const api = new CivicClerkClient({
    async getJson<T>(url: string): Promise<T> { calls.push(url); return (calls.length === 1 ? { value: [], "@odata.nextLink": next } : { value: [] }) as T; },
    async request<T>(): Promise<T> { throw new Error("unexpected document transfer"); },
  }, base);
  await expect(api.listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("pagination"); expect(calls).toHaveLength(1);
});
test("cross-endpoint PDF response is never requested or consumed as JSON", async () => {
  let calls = 0, pdfBytes = 0;
  const http = new PoliteHttpClient({ minIntervalMs: 0 }, { fetch: async () => {
    if (++calls === 1) return Response.json({ value: [], "@odata.nextLink": "Meetings/GetMeetingFileStream(fileId=158,plainText=false)?$skip=1" });
    const body = "%PDF-1.7\nnot a listing"; pdfBytes += body.length;
    return new Response(body, { headers: { "content-type": "application/pdf" } });
  } });
  await expect(new CivicClerkClient(http, base).listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("pagination");
  expect(calls).toBe(1); expect(pdfBytes).toBe(0);
});
test("relative and absolute Events skip/skiptoken links preserve exact fixed query bounds", async () => {
  const links = ["Events?$skip=25", "?$skip=50", `${base}Events?$skiptoken=Id%3D59%2CName%3D%27Court%27`, `?$skiptoken=${"x".repeat(4096)}`];
  const calls: URL[] = [];
  const api = new CivicClerkClient({ async getJson<T>(url: string): Promise<T> {
    calls.push(new URL(url)); const next = links.shift(); const value=calls.length<=2?Array.from({length:25},(_,i)=>({id:(calls.length-1)*25+i+1,eventName:"Fixture",eventDate:"2021-01-05T00:00:00Z",publishedFiles:[]})):[];return { value, "@odata.count": 50, ...(next ? { "@odata.nextLink": next } : {}) } as T;
  }, async request<T>(): Promise<T> { throw new Error("unexpected"); } }, base);
  expect((await api.listEvents("2021-01-05", "2021-01-05")).map(event=>event.id)).toEqual(Array.from({length:50},(_,i)=>i+1)); expect(calls).toHaveLength(5);
  for (const url of calls) {
    expect(url.origin + url.pathname).toBe(base + "Events");
    for (const key of ["$filter", "$top", "$count"]) expect(url.searchParams.getAll(key)).toEqual(calls[0]!.searchParams.getAll(key));
  }
  expect(calls[3]!.searchParams.get("$skiptoken")).toBe("Id=59,Name='Court'");
});
test("reordered fixed bounds with a valid continuation are accepted once, repeated tokens cycle", async () => {
  let calls = 0;
  const api = new CivicClerkClient({ async getJson<T>(url: string): Promise<T> {
    calls++; const next = new URL(url); next.searchParams.set("$skiptoken", "Id-59"); next.searchParams.sort();
    return { value: [], "@odata.nextLink": next.href } as T;
  }, async request<T>(): Promise<T> { throw new Error("unexpected"); } }, base);
  await expect(api.listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("pagination"); expect(calls).toBe(2);
});
test("credential-bearing collection bases reject before transport", async () => {
  for (const base of ["https://user@example.test/v1/", "https://:pass@example.test/v1/"]) {
    let calls = 0;
    const api = new CivicClerkClient({ async getJson<T>(): Promise<T> { calls++; return { value: [] } as T; }, async request<T>(): Promise<T> { throw new Error("unexpected"); } }, base);
    await expect(api.listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("pagination"); expect(calls).toBe(0);
  }
});
test("skip continuations cannot move backward", async () => {
  let calls = 0;
  const api = new CivicClerkClient({ async getJson<T>(): Promise<T> { calls++;return { value: [{id:calls,eventName:"Fixture",eventDate:"2021-01-05T00:00:00Z",publishedFiles:[]}], "@odata.nextLink": `?$skip=${calls === 1 ? 1 : 0}` } as T; }, async request<T>(): Promise<T> { throw new Error("unexpected"); } }, base);
  await expect(api.listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("pagination"); expect(calls).toBe(2);
});
