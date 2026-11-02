import { expect, test } from "bun:test";
import { PoliteHttpClient } from "../src/http";

test("transient HTTP failures back off exponentially with jitter and cancel discarded bodies", async () => {
  let time = 0, calls = 0, cancelled = 0;
  const waits: number[] = [];
  const http = new PoliteHttpClient({ minIntervalMs: 0, maxRetries: 2 }, {
    now: () => time, random: () => 0.5,
    sleep: async ms => { waits.push(ms); time += ms; },
    fetch: async () => { calls++; if (calls === 3) return Response.json({ ok: true }); return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 }); },
  });
  expect(await http.getJson<{ ok: boolean }>("https://example.test")).toEqual({ ok: true });
  expect(waits).toEqual([625, 1125]);
  expect(calls).toBe(3);
  expect(cancelled).toBe(2);
});

test("Retry-After governs retries and subsequent requests after successful responses", async () => {
  let time = 0, calls = 0;
  const starts: number[] = [], waits: number[] = [];
  const http = new PoliteHttpClient({ minIntervalMs: 0 }, {
    now: () => time, random: () => 0,
    sleep: async ms => { waits.push(ms); time += ms; },
    fetch: async () => { starts.push(time); calls++; return Response.json({ call: calls }, { status: calls === 1 ? 429 : 200, headers: { "Retry-After": calls === 1 ? "2" : calls === 2 ? "3" : "0" } }); },
  });
  expect(await http.getJson<{ call: number }>("https://example.test/a")).toEqual({ call: 2 });
  await http.getJson("https://example.test/b");
  expect(starts).toEqual([0, 2000, 5000]);
  expect(waits).toEqual([2000, 3000]);
});

for (const [name, headers, delay] of [
  ["HTTP date with server clock skew", { Date: "Wed, 01 Jan 2020 00:00:00 GMT", "Retry-After": "Wed, 01 Jan 2020 00:00:04 GMT" }, 4000],
  ["standard remaining/reset", { "RateLimit-Remaining": "0", "RateLimit-Reset": "5" }, 5000],
  ["legacy epoch reset", { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "106" }, 6000],
  ["structured rate limit", { RateLimit: '"default";r=0;t=7' }, 7000],
  ["longest server instruction", { "Retry-After": "2", "RateLimit-Remaining": "0", "RateLimit-Reset": "5" }, 5000],
  ["HTTP date without a server date", { "Retry-After": "Thu, 01 Jan 1970 00:01:44 GMT" }, 4000],
  ["HTTP date with an invalid server date", { Date: "invalid", "Retry-After": "Thu, 01 Jan 1970 00:01:44 GMT" }, 4000],
  ["structured time followed by another parameter", { RateLimit: '"default";r=0;t=7;extra=1' }, 7000],
  ["multiple structured policies with list whitespace", { RateLimit: '"first";r=0;t=7 , "second";r=0;t=3' }, 7000],
  ["structured remaining followed by list whitespace", { RateLimit: '"first";t=7;r=0 , "second";r=1;t=9' }, 7000],
] as const) {
  test(`honors ${name} across successful requests`, async () => {
    let time = 100_000, calls = 0;
    const starts: number[] = [];
    const http = new PoliteHttpClient({ minIntervalMs: 0 }, { now: () => time, sleep: async ms => { time += ms; }, fetch: async () => { starts.push(time); return Response.json({}, { headers: ++calls === 1 ? headers : {} }); } });
    await http.getJson("https://example.test/a"); await http.getJson("https://example.test/b");
    expect(starts).toEqual([100_000, 100_000 + delay]);
  });
}

for (const [name, headers] of [
  ["missing headers", {}],
  ["blank Retry-After", { "Retry-After": " " }],
  ["invalid Retry-After", { "Retry-After": "not-a-date" }],
  ["negative Retry-After", { "Retry-After": "-2" }],
  ["past Retry-After date", { "Retry-After": "Thu, 01 Jan 1970 00:00:01 GMT" }],
  ["nonempty quota", { "RateLimit-Remaining": "1", "RateLimit-Reset": "5" }],
  ["missing reset", { "RateLimit-Remaining": "0" }],
  ["blank reset", { "RateLimit-Remaining": "0", "RateLimit-Reset": " " }],
  ["invalid reset", { "RateLimit-Remaining": "0", "RateLimit-Reset": "invalid" }],
  ["negative reset", { "RateLimit-Remaining": "0", "RateLimit-Reset": "-2" }],
  ["past legacy reset", { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "99" }],
  ["invalid legacy reset", { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "invalid" }],
  ["blank structured header", { RateLimit: " " }],
  ["available structured quota", { RateLimit: '"default";r=1;t=7' }],
  ["missing structured time", { RateLimit: '"default";r=0' }],
  ["invalid structured time", { RateLimit: '"default";r=0;t=invalid' }],
  ["negative structured time", { RateLimit: '"default";r=0;t=-7' }],
  ["partially numeric structured time", { RateLimit: '"default";r=0;t=7invalid' }],
] as const) {
  test(`ignores ${name} without introducing a cooldown`, async () => {
    let time = 100_000, calls = 0;
    const waits: number[] = [];
    const http = new PoliteHttpClient({ minIntervalMs: 0 }, {
      now: () => time,
      sleep: async ms => { waits.push(ms); time += ms; },
      fetch: async () => Response.json({}, { headers: ++calls === 1 ? headers : {} }),
    });
    await http.getJson("https://example.test/a");
    await http.getJson("https://example.test/b");
    expect(calls).toBe(2);
    expect(waits).toEqual([]);
  });
}

test("server cooldowns remain uncapped and sleep in timer-safe chunks", async () => {
  let time = 0, calls = 0;
  const waits: number[] = [], starts: number[] = [];
  const delay = 2_147_484_000;
  const http = new PoliteHttpClient({ minIntervalMs: 0 }, {
    now: () => time,
    sleep: async ms => { waits.push(ms); time += ms; },
    fetch: async () => {
      starts.push(time);
      return Response.json({}, { headers: ++calls === 1 ? { "Retry-After": String(delay / 1000) } : {} });
    },
  });
  await http.getJson("https://example.test/a");
  await http.getJson("https://example.test/b");
  expect(starts).toEqual([0, delay]);
  expect(waits).toEqual([2_147_483_647, delay - 2_147_483_647]);
});

test("default pacing leaves a full second after a completed request", async () => {
  let time = 0;
  const starts: number[] = [];
  const http = new PoliteHttpClient({}, { now: () => time, sleep: async ms => { time += ms; }, fetch: async () => { starts.push(time); return Response.json({}); } });
  await http.getJson("https://example.test/a"); await http.getJson("https://example.test/b");
  expect(starts).toEqual([0, 1000]);
});

test("timeout covers a stalled response body, not just headers", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }));
  } });
  try {
    const http = new PoliteHttpClient({ minIntervalMs: 0, timeoutMs: 20, maxRetries: 0 });
    const outcome = http.getJson(server.url.href).then(() => "completed", error => String(error));
    expect(await Promise.race([outcome, Bun.sleep(150).then(() => "hung")])).toMatch(/timed out|abort/i);
  } finally { server.stop(true); }
});

test("requests identify the client honestly and support a custom user agent", async () => {
  const agents: string[] = [];
  for (const options of [{ minIntervalMs: 0 }, { minIntervalMs: 0, userAgent: "operator-contact" }, { minIntervalMs: 0, userAgent: "" }]) {
    const http = new PoliteHttpClient(options, { fetch: async (_url, init) => {
      agents.push(new Headers(init.headers).get("User-Agent") ?? "");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Response.json({});
    } });
    await http.getJson("https://example.test");
  }
  expect(agents[0]).toContain("atxdata-civicclerk");
  expect(agents[1]).toBe("operator-contact");
  expect(agents[2]).toBe("");
});

for (const error of [new TypeError("connection lost"), new DOMException("Request timed out", "TimeoutError"), Object.assign(new Error("reset"), { code: "ECONNRESET" })]) {
  test(`retries transient transport/body errors: ${error.name} ${error.message}`, async () => {
    let time = 0, calls = 0;
    const http = new PoliteHttpClient({ minIntervalMs: 0, maxRetries: 1 }, { now: () => time, random: () => 0, sleep: async ms => { time += ms; }, fetch: async () => { if (++calls === 1) throw error; return Response.json({ ok: true }); } });
    expect(await http.getJson<{ ok: boolean }>("https://example.test")).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(time).toBe(500);
  });
}

test("rejects invalid retry and timing configuration", () => {
  for (const options of [{ maxRetries: -1 }, { maxRetries: 1.5 }, { maxRetries: NaN }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 2_147_483_648 }, { minIntervalMs: -1 }, { minIntervalMs: NaN }]) {
    expect(() => new PoliteHttpClient(options)).toThrow();
  }
});

test("accepts the inclusive timer-safe upper boundary for each numeric option", () => {
  for (const key of ["maxRetries", "timeoutMs", "minIntervalMs"] as const) {
    expect(() => new PoliteHttpClient({ [key]: 2_147_483_647 })).not.toThrow();
  }
});

for (const status of [408, 409, 425, 429, 500, 599]) {
  test(`retries transient HTTP ${status}`, async () => {
    let time = 0, calls = 0;
    const http = new PoliteHttpClient({ minIntervalMs: 0, maxRetries: 1 }, {
      now: () => time, random: () => 0,
      sleep: async ms => { time += ms; },
      fetch: async () => ++calls === 1 ? new Response(null, { status }) : Response.json({ recovered: true }),
    });
    expect(await http.getJson<{ recovered: boolean }>("https://example.test")).toEqual({ recovered: true });
    expect(calls).toBe(2);
    expect(time).toBe(500);
  });
}

test("responses without bodies do not fail cleanup or poison the queue", async () => {
  let calls = 0;
  const http = new PoliteHttpClient({ minIntervalMs: 0 }, {
    fetch: async () => { calls++; return new Response(null, { status: 204 }); },
  });
  expect(await http.request("https://example.test/a", response => response.text())).toBe("");
  expect(await http.request("https://example.test/b", response => response.text())).toBe("");
  expect(calls).toBe(2);
});

test("fetch failures without a response preserve the original error during cleanup", async () => {
  const failure = new Error("unrecoverable transport failure");
  let calls = 0;
  const http = new PoliteHttpClient({ minIntervalMs: 0 }, {
    fetch: async () => { calls++; throw failure; },
  });
  await expect(http.getJson("https://example.test")).rejects.toBe(failure);
  expect(calls).toBe(1);
});

test("retry budget is finite and a rejected operation does not poison the queue", async () => {
  let calls = 0, time = 0;
  const http = new PoliteHttpClient({ maxRetries: 2, minIntervalMs: 0 }, { now: () => time, random: () => 0, sleep: async ms => { time += ms; }, fetch: async () => new Response("", { status: ++calls <= 3 ? 503 : 200 }) });
  await expect(http.getJson("https://example.test/a")).rejects.toThrow("HTTP 503");
  expect(calls).toBe(3);
  expect(await http.request("https://example.test/b", r => r.text())).toBe("");
  expect(calls).toBe(4);
});

for (const status of [400, 401, 403, 404]) {
  test(`does not retry permanent HTTP ${status}`, async () => {
    let calls = 0;
    const http = new PoliteHttpClient({ minIntervalMs: 0 }, { fetch: async () => { calls++; return new Response("", { status }); } });
    await expect(http.getJson("https://example.test")).rejects.toThrow(`HTTP ${status}`);
    expect(calls).toBe(1);
  });
}

test("failed body consumption can retry the whole transfer", async () => {
  let calls = 0, time = 0;
  const http = new PoliteHttpClient({ minIntervalMs: 0 }, { now: () => time, sleep: async ms => { time += ms; }, fetch: async () => new Response("body") });
  expect(await http.request("https://example.test", async response => {
    if (++calls === 1) throw new TypeError("broken body");
    return response.text();
  })).toBe("body");
  expect(calls).toBe(2);
});

test("retries actual Bun connection-refusal errors", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unused") });
  const url = server.url.href;
  server.stop(true);
  let calls = 0, time = 0;
  const http = new PoliteHttpClient({ minIntervalMs: 0, maxRetries: 1 }, {
    now: () => time, sleep: async ms => { time += ms; }, random: () => 0,
    fetch: async () => { if (++calls === 1) return fetch(url); return Response.json({ recovered: true }); },
  });
  expect(await http.getJson<{ recovered: boolean }>(url)).toEqual({ recovered: true });
  expect(calls).toBe(2);
  expect(time).toBe(500);
});

test("concurrent callers are serialized through complete body consumption", async () => {
  let active = 0, peak = 0;
  const http = new PoliteHttpClient({ minIntervalMs: 0 }, { fetch: async () => {
    active++; peak = Math.max(peak, active); return new Response("document");
  } });
  const consume = async (response: Response) => { await Bun.sleep(5); const body = await response.text(); active--; return body; };
  expect(await Promise.all([http.request("https://example.test/a", consume), http.request("https://example.test/b", consume)])).toEqual(["document", "document"]);
  expect(peak).toBe(1);
});
