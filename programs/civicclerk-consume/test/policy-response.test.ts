import { test, expect } from "bun:test";
import { PoliteHttpClient } from "../src/http";
for (const status of [200, 301, 302, 403, 429, 503])
  test("opt-in capture original response/status " + status, async () => {
    const response = new Response(new Uint8Array([255, 0, 254]), {
      status,
      headers: {
        location: "https://example.invalid/",
        "x-fixture": "unchanged",
      },
    });
    let calls = 0;
    const c = new PoliteHttpClient(
      { maxRetries: 2, minIntervalMs: 0 },
      {
        fetch: async () => {
          calls++;
          return response;
        },
      },
    );
    const got = await c.captureResponse(
      "https://example.invalid",
      async (r) => {
        expect(r).toBe(response);
        expect(r.status).toBe(status);
        expect(r.headers.get("x-fixture")).toBe("unchanged");
        return Buffer.from(await r.arrayBuffer());
      },
    );
    expect(got).toEqual(Buffer.from([255, 0, 254]));
    expect(calls).toBe(1);
  });
test("default request still rejects non2xx without consuming callback", async () => {
  let consumed = false;
  const c = new PoliteHttpClient(
    { maxRetries: 0, minIntervalMs: 0 },
    { fetch: async () => new Response("body", { status: 404 }) },
  );
  await expect(
    c.request("https://example.invalid", async () => {
      consumed = true;
    }),
  ).rejects.toThrow("HTTP 404");
  expect(consumed).toBe(false);
});
test("raw native timeout aborts the same signal and never retries", async () => {
  let aborted = false,
    calls = 0;
  const c = new PoliteHttpClient(
    { timeoutMs: 20, maxRetries: 5, minIntervalMs: 0 },
    {
      fetch: async (_u, init) => {
        calls++;
        return new Response(
          new ReadableStream({
            start(controller) {
              init.signal!.addEventListener("abort", () => {
                aborted = true;
                controller.error(init.signal!.reason);
              });
            },
          }),
          { status: 503 },
        );
      },
    },
  );
  await expect(
    c.captureResponse("https://example.invalid", (r) => r.arrayBuffer()),
  ).rejects.toThrow();
  expect(aborted).toBe(true);
  expect(calls).toBe(1);
});
test("raw capture shares complete-body queue and server obligations", async () => {
  let now = 0,
    requests = 0,
    release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const c = new PoliteHttpClient(
    { minIntervalMs: 3000 },
    {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      fetch: async () => {
        requests++;
        return new Response("x", {
          status: 503,
          headers: { "retry-after": "7" },
        });
      },
    },
  );
  const one = c.captureResponse("https://example.invalid", async (r) => {
    await held;
    return r.text();
  });
  const two = c.captureResponse("https://example.invalid", (r) => r.text());
  await Bun.sleep(10);
  expect(requests).toBe(1);
  release();
  await Promise.all([one, two]);
  expect(requests).toBe(2);
  expect(now).toBeGreaterThanOrEqual(7000);
});
