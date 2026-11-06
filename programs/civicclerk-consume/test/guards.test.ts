import { expect, test } from "bun:test";
import { CivicClerkClient } from "../src/client";
import { PoliteHttpClient } from "../src/http";
test("invalid page counts stop before next discovery; consistent counts remain accepted", async () => {
  for (const count of [-1, 1.5, "1", null]) {
    let calls = 0;
    const http = new PoliteHttpClient({ minIntervalMs: 0 }, { fetch: async () => { calls++; return Response.json({ value: [], "@odata.count": count, "@odata.nextLink": "?$skip=1" }); } });
    await expect(new CivicClerkClient(http).listEvents("2021-01-05", "2021-01-05")).rejects.toThrow("count"); expect(calls).toBe(1);
  }
  let calls = 0;
  const http = new PoliteHttpClient({ minIntervalMs: 0 }, { fetch: async () => Response.json(++calls === 1 ? { value: [], "@odata.count": 0, "@odata.nextLink": "?$skip=1" } : { value: [], "@odata.count": 0 }) });
  expect(await new CivicClerkClient(http).listEvents("2021-01-05", "2021-01-05")).toEqual([]); expect(calls).toBe(2);
});
test("permanent HTTP statuses never retry even when a retry budget was explicitly enabled", async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    const http = new PoliteHttpClient({ maxRetries: 2, minIntervalMs: 0 }, { fetch: async () => { calls++; return new Response(null, { status }); } });
    await expect(http.getJson("https://example.test")).rejects.toThrow(`HTTP ${status}`); expect(calls).toBe(1);
  }
});
test("explicit retries report the actual attempt number without access URLs", async () => {
  const messages: unknown[] = [], original = console.warn;
  console.warn = message => { messages.push(message); };
  try {
    let calls = 0, time = 0;
    const http = new PoliteHttpClient({ maxRetries: 1, minIntervalMs: 0 }, { now: () => time, sleep: async ms => { time += ms; }, fetch: async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json({}) });
    await http.getJson("https://example.test"); expect(messages).toEqual(["HTTP retry 1"]);
  } finally { console.warn = original; }
});
