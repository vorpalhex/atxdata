import { expect, test } from "bun:test";
import { check, classify, main } from "../../scripts/check-legistar-api";

const api = "https://webapi.legistar.com/fixture";
test("classification retains target priority, API-only success, token evidence and inconclusive fallback", () => {
  expect(classify([{ name: "City Council event items", url: api, status: 200 }])).toContain("Use client key `austintexas`");
  expect(classify([{ name: "other", url: api, status: 299 }])).toContain("First successful check: other");
  expect(classify([{ name: "portal", url: "https://fixture.invalid", status: 200 }])).toContain("inconclusive");
  expect(classify([{ name: "denial", url: api, status: 401, bodyPreview: "token required" }])).toContain("does not appear usable");
  expect(classify([{ name: "denial", url: api, status: 403, statusText: "unauthorized" }])).toContain("does not appear usable");
  expect(classify([{ name: "error", url: api, status: 500 }, { name: "denial", url: api, status: 403, bodyPreview: "plain denial" }])).toContain("inconclusive");
});

test("imported diagnostic information and parse errors never invoke fetch", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("unexpected fixture call"); }) as unknown as typeof fetch;
  try {
    for (const args of [["--help"], ["-h"], ["--version"], ["--help", "--version"]]) {
      const lines: string[] = []; let flushed = false;
      await main(args, { line: text => { lines.push(text); }, flush: async () => { flushed = true; } });
      expect(lines.join("\n")).toContain(args[0] === "--version" ? "check-legistar-api 0.1.0" : "nine serial");
      expect(flushed).toBe(true);
    }
    for (const args of [["--invalid"], ["--", "--help"], ["operand", "--help"]]) await expect(main(args)).rejects.toThrow();
    expect(calls).toBe(0);
  } finally { globalThis.fetch = original; }
});

test("imported diagnostic renders nine serial bounded responses, failures and verdict", async () => {
  const original = globalThis.fetch;
  const lines: string[] = [], modes: unknown[] = [];
  let calls = 0, active = 0, peak = 0, flushed = false;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls++; active++; peak = Math.max(peak, active); modes.push(init?.redirect);
    await Bun.sleep(1); active--;
    if (calls === 1) throw new Error("private unsafe reason");
    if (calls === 2) return new Response(null, { status: 204 });
    if (calls === 3) return new Response("", { status: 200 });
    return new Response("  fixture\n body  ", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  try {
    await main([], { line: text => { lines.push(text); }, flush: async () => { flushed = true; } });
    expect(calls).toBe(9); expect(peak).toBe(1); expect(modes).toEqual(Array(9).fill("manual"));
    expect(lines.filter(line => line.startsWith("\n## "))).toHaveLength(10);
    expect(lines).toContain("ERROR: diagnostic request failed"); expect(lines).toContain("body: (empty)");
    expect(lines).toContain("content-type: (none)"); expect(lines).toContain("body: fixture body");
    expect(lines.join("\n")).not.toContain("private unsafe reason"); expect(flushed).toBe(true);
  } finally { globalThis.fetch = original; }
});

test("check handles preaborted and successful bodies without inferring success from a body failure", async () => {
  const aborted = new AbortController(); aborted.abort();
  const stopped = await check("stop", api, { signal: aborted.signal, fetcher: (async () => new Response("late")) as unknown as typeof fetch });
  expect(stopped.error).toBe("diagnostic interrupted");
  const result = await check("ok", api, { fetcher: (async () => new Response(" a\n b ")) as unknown as typeof fetch });
  expect(result).toMatchObject({ status: 200, bodyPreview: "a b" });
});

test("default diagnostic body ceiling accepts exactly 64 KiB and rejects the next byte", async () => {
  for (const size of [65_536, 65_537]) {
    const result = await check("bytes", api, { fetcher: (async () => new Response("x".repeat(size))) as unknown as typeof fetch });
    if (size === 65_536) { expect(result.status).toBe(200); expect(result.bodyPreview).toBe("x".repeat(220)); }
    else { expect(result.error).toBe("diagnostic response byte limit exceeded"); expect(result.status).toBeUndefined(); }
  }
});
