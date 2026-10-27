import { expect, test } from "bun:test";
import { createHttpClient, sleep } from "../../src/util/http";
import type { AppConfig } from "../../src/config";

const config = { userAgent: "test-agent", httpTimeoutMs: 100, maxDownloadRetries: 0 } as AppConfig;
const logger = { info() {}, warn() {}, error() {} };

test("HTTP logs measure elapsed duration instead of adding clock timestamps", async () => {
  for (const failing of [false, true]) {
    const records: Record<string, unknown>[] = [];
    const times = [100, 125];
    const capture = { info(_event: string, data?: Record<string, unknown>) { records.push(data!); }, warn(_event: string, data?: Record<string, unknown>) { records.push(data!); }, error() {} };
    const client = createHttpClient(config, capture, {
      now: () => times.shift()!,
      fetch: async () => { if (failing) throw new Error("transport failed"); return new Response("ok"); },
    });
    if (failing) await expect(client.fetchWithRetry("unused")).rejects.toThrow("transport failed");
    else expect(await (await client.fetchWithRetry("unused")).text()).toBe("ok");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ elapsedMs: 25, attempt: 0, url: "unused" });
  }
});

test("merges Headers and tuple headers case-insensitively", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { return Response.json(Object.fromEntries(request.headers)); } });
  try {
    const client = createHttpClient(config, logger);
    for (const headers of [new Headers({ accept: "custom", "x-test": "yes" }), [["accept", "custom"], ["x-test", "yes"]] as [string, string][]]) {
      const response = await client.fetchWithRetry(server.url.href, { headers });
      const result = await response.json();
      expect(result.accept).toBe("custom");
      expect(result["x-test"]).toBe("yes");
      expect(result["user-agent"]).toBe("test-agent");
    }
  } finally { server.stop(true); }
});

test("timeout remains active while reading response body", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("start")); } }));
  } });
  try {
    const client = createHttpClient({ ...config, httpTimeoutMs: 20 }, logger);
    const response = await client.fetchWithRetry(server.url.href);
    const result = await Promise.race([response.text().then(() => "finished", () => "aborted"), Bun.sleep(100).then(() => "hung")]);
    expect(result).toBe("aborted");
  } finally { server.stop(true); }
});

test("cancels retry response before waiting and uses Retry-After", async () => {
  let calls = 0;
  let cancelled = false;
  const waits: number[] = [];
  const client = createHttpClient({ ...config, maxDownloadRetries: 1 }, logger, {
    fetch: async () => {
      calls++;
      if (calls === 2) return Response.json({ ok: true });
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 429, headers: { "Retry-After": "0" } });
    },
    sleep: async (ms: number) => { expect(cancelled).toBe(true); waits.push(ms); },
  });
  const response = await client.fetchWithRetry("http://127.0.0.1:1");
  expect(await response.json()).toEqual({ ok: true });
  expect(calls).toBe(2);
  expect(waits).toEqual([0]);
});

function injected(fetcher: (url: string, init: RequestInit) => Promise<Response>, overrides: Partial<AppConfig> = {}, extras = {}) {
  return createHttpClient({ ...config, ...overrides }, logger, { fetch: fetcher, sleep: async () => {}, random: () => 0, ...extras });
}

for (const status of [408, 409, 425, 429, 500, 503]) {
  test(`retries ${status} exactly up to configured budget`, async () => {
    let calls = 0;
    const client = injected(async () => { calls++; return new Response("failed", { status }); }, { maxDownloadRetries: 2 });
    const response = await client.fetchWithRetry("unused");
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("failed");
    expect(calls).toBe(3);
  });
}

for (const status of [200, 400, 401, 404]) {
  test(`does not retry ${status}`, async () => {
    let calls = 0;
    const client = injected(async () => { calls++; return new Response("result", { status }); }, { maxDownloadRetries: 2 });
    expect(await (await client.fetchWithRetry("unused")).text()).toBe("result");
    expect(calls).toBe(1);
  });
}

test("retries thrown errors with bounded exponential backoff and preserves final error", async () => {
  const waits: number[] = [];
  const error = new Error("offline");
  let calls = 0;
  const client = injected(async () => { calls++; throw error; }, { maxDownloadRetries: 7 }, { sleep: async (ms: number) => { waits.push(ms); }, random: () => 0.5 });
  await expect(client.fetchWithRetry("unused")).rejects.toBe(error);
  expect(calls).toBe(8);
  expect(waits).toEqual([625, 1125, 2125, 4125, 8125, 16125, 30000]);
});

test("normalizes non-Error failures and succeeds after a transport failure", async () => {
  await expect(injected(async () => { throw "failure"; }).fetchWithRetry("unused")).rejects.toThrow("failure");
  let calls = 0;
  const client = injected(async () => { if (++calls === 1) throw "temporary"; return Response.json({ recovered: true }); }, { maxDownloadRetries: 1 });
  expect(await client.getJson<{ recovered: boolean }>("unused")).toEqual({ recovered: true });
});

for (const [header, expected] of [["2", 2000], ["-1", 0], ["Wed, 01 Jan 2020 00:00:03 GMT", 3000], ["Tue, 31 Dec 2019 23:59:59 GMT", 0], ["invalid", 500], ["", 500]] as const) {
  test(`Retry-After ${JSON.stringify(header)} selects ${expected}ms`, async () => {
    let calls = 0;
    const waits: number[] = [];
    const client = injected(async () => ++calls === 1 ? new Response(null, { status: 503, headers: { "Retry-After": header } }) : new Response(null, { status: 204 }), { maxDownloadRetries: 1 }, { now: () => Date.parse("2020-01-01T00:00:00Z"), sleep: async (ms: number) => { waits.push(ms); } });
    expect((await client.fetchWithRetry("unused")).status).toBe(204);
    expect(waits).toEqual([expected]);
  });
}

test("getJson requests JSON and reports bounded error details", async () => {
  const client = injected(async (_url, init) => {
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
    return new Response("x".repeat(600), { status: 404 });
  });
  await expect(client.getJson("resource")).rejects.toThrow(`GET resource failed with 404: ${"x".repeat(500)}`);
  await expect(injected(async () => new Response("invalid json")).getJson("resource")).rejects.toBeInstanceOf(SyntaxError);
});

test("response cancellation clears its timeout and releases its body", async () => {
  let signal: AbortSignal;
  let reason: unknown;
  const client = injected(async (_url, init) => {
    signal = init.signal!;
    return new Response(new ReadableStream({ cancel(value) { reason = value; } }));
  }, { httpTimeoutMs: 5 });
  const response = await client.fetchWithRetry("unused");
  await response.body!.cancel("not needed");
  await Bun.sleep(15);
  expect(reason).toBe("not needed");
  expect(signal!.aborted).toBe(false);
});

test("fully consumed and bodyless responses clear timeouts", async () => {
  const signals: AbortSignal[] = [];
  let calls = 0;
  const client = injected(async (_url, init) => {
    signals.push(init.signal!);
    return ++calls === 1 ? new Response("done") : new Response(null, { status: 204 });
  }, { httpTimeoutMs: 5 });
  expect(await (await client.fetchWithRetry("unused")).text()).toBe("done");
  expect((await client.fetchWithRetry("unused")).status).toBe(204);
  await Bun.sleep(15);
  expect(signals.map(signal => signal.aborted)).toEqual([false, false]);
});

test("body read errors release timeout without hiding the original failure", async () => {
  let signal: AbortSignal;
  const error = new Error("body failed");
  const client = injected(async (_url, init) => {
    signal = init.signal!;
    return new Response(new ReadableStream({ pull(controller) { controller.error(error); } }));
  }, { httpTimeoutMs: 5 });
  await expect((await client.fetchWithRetry("unused")).text()).rejects.toBe(error);
  await Bun.sleep(15);
  expect(signal!.aborted).toBe(false);
});

test("caller abort is passed through and is not retried", async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = injected(async (_url, init) => {
    calls++;
    controller.abort(new Error("caller cancelled"));
    init.signal!.throwIfAborted();
    return new Response(null);
  }, { maxDownloadRetries: 2 });
  await expect(client.fetchWithRetry("unused", { signal: controller.signal })).rejects.toThrow("caller cancelled");
  expect(calls).toBe(1);
  await expect(client.fetchWithRetry("unused", { signal: controller.signal })).rejects.toThrow("caller cancelled");
  expect(calls).toBe(1);
});

test("timeout aborts a pending fetch and retries it", async () => {
  let calls = 0;
  const client = injected(async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
  }, { httpTimeoutMs: 5, maxDownloadRetries: 1 });
  await expect(client.fetchWithRetry("unused")).rejects.toThrow("Request timed out");
  expect(calls).toBe(2);
});

test("retry wait starts after attempt timeout cleanup", async () => {
  let calls = 0;
  let signal: AbortSignal;
  const client = injected(async (_url, init) => {
    signal = init.signal!;
    if (++calls === 1) return new Response("retry", { status: 503 });
    return new Response("done");
  }, { httpTimeoutMs: 5, maxDownloadRetries: 1 }, { sleep: async () => { await Bun.sleep(15); expect(signal.aborted).toBe(false); } });
  expect(await (await client.fetchWithRetry("unused")).text()).toBe("done");
});

test("preserves request options, caller header overrides and response metadata", async () => {
  const client = injected(async (_url, init) => {
    expect(init.method).toBe("POST");
    expect(init.body).toBe("payload");
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("user-agent")).toBe("caller-agent");
    const response = new Response("done", { status: 201, statusText: "Created", headers: { "x-response": "yes" } });
    Object.defineProperties(response, { url: { value: "http://127.0.0.1/final" }, redirected: { value: true }, type: { value: "basic" } });
    return response;
  });
  const response = await client.fetchWithRetry("unused", { method: "POST", body: "payload", redirect: "manual", headers: { "user-agent": "caller-agent" } });
  expect(response.url).toBe("http://127.0.0.1/final");
  expect(response.redirected).toBe(true);
  expect(response.type).toBe("basic");
  expect(response.status).toBe(201);
  expect(response.statusText).toBe("Created");
  expect(response.headers.get("x-response")).toBe("yes");
  expect(await response.text()).toBe("done");
});

test("zero sleep resolves and rejected waits are not mistaken for failed requests", async () => {
  await sleep(0);
  let calls = 0;
  const error = new Error("wait failed");
  const client = injected(async () => { calls++; return new Response(null, { status: 503 }); }, { maxDownloadRetries: 2 }, { sleep: async () => { throw error; } });
  await expect(client.fetchWithRetry("unused")).rejects.toBe(error);
  expect(calls).toBe(1);
});

test("discarded response cancellation failures do not prevent a retry", async () => {
  let calls = 0;
  const client = injected(async () => ++calls === 1 ? new Response(new ReadableStream({ cancel() { throw new Error("cancel failed"); } }), { status: 503 }) : new Response("recovered"), { maxDownloadRetries: 1 });
  expect(await (await client.fetchWithRetry("unused")).text()).toBe("recovered");
  expect(calls).toBe(2);
});
