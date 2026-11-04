import { expect, test } from "bun:test";
import { CivicClerkClient } from "../src/client";
const event = { id: 59, eventName: "Court", eventDate: "2021-01-05T09:00:00Z", publishedFiles: [] };
function pages(responses: unknown[]) {
  const urls: string[] = [];
  return { urls, api: new CivicClerkClient({ async getJson<T>(url: string) { urls.push(url); return responses.shift() as T; }, async request<T>(): Promise<T> { throw new Error("unexpected"); } }, "https://example.test/v1/") };
}
test("bounds discovery and preserves date filter on pagination", async () => {
  const { urls, api } = pages([{ value: [event], "@odata.nextLink": "?$skip=1", "@odata.count": 1 }, { value: [] }]);
  expect(await api.listEvents("2021-01-05", "2021-01-05")).toHaveLength(1);
  for (const url of urls) { expect(new URL(url).searchParams.get("$top")).toBe("25"); expect(new URL(url).searchParams.get("$filter")).toContain("2021-01-05"); }
});
test("rejects out-of-range, duplicate, oversized and count-inconsistent discovery", async () => {
  for (const response of [{ value: [{ ...event, eventDate: "2022-01-01T09:00:00Z" }] }, { value: [event, event] }, { value: Array(26).fill(event) }, { value: [event], "@odata.count": 2 }]) {
    await expect(pages([response]).api.listEvents("2021-01-05", "2021-01-05")).rejects.toThrow();
  }
});

test("validates zero, invalid and changing OData counts", async () => {
  expect(await pages([{ value: [], "@odata.count": 0 }]).api.listEvents("2021-01-05", "2021-01-05")).toEqual([]);
  for (const count of [-1, 1.5, "1", null, true]) await expect(pages([{ value: [], "@odata.count": count }]).api.listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("count");
  await expect(pages([{ value: [], "@odata.count": 1, "@odata.nextLink": "?$skip=1" }, { value: [event], "@odata.count": 2 }]).api.listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("count");
});
test("accepts exactly 25 records and stops before requesting a twenty-first page", async () => {
  expect(await pages([{ value: Array.from({length:25}, (_,i) => ({...event,id:i+1})), "@odata.count":25 }]).api.listEvents("2021-01-05", "2021-01-05")).toHaveLength(25);
  const f = pages(Array.from({length:21},(_,i)=>({value:[], "@odata.nextLink":`?$skip=${i+1}`})));
  await expect(f.api.listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("ceiling"); expect(f.urls).toHaveLength(20);
});
