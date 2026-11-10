import { expect, test } from "bun:test";
import * as diagnostic from "../../scripts/check-legistar-api";

type Check = (name: string, url: string, options: { fetcher: typeof fetch; timeoutMs?: number; maxBytes?: number }) => Promise<{ error?: string; status?: number; bodyPreview?: string }>;
const check = (diagnostic as unknown as { check: Check }).check;
test("diagnostic bounds fetch deadline even when fixture ignores abort", async () => {
  const result = await check("fixture", "https://fixture.invalid", { timeoutMs: 20, fetcher: (() => new Promise(() => {})) as unknown as typeof fetch });
  expect(result.error).toContain("deadline");
});
test("diagnostic bounds response bytes and cancels oversized body", async () => {
  let cancelled = false;
  const result = await check("fixture", "https://fixture.invalid", { maxBytes: 8, fetcher: (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; } }))) as unknown as typeof fetch });
  expect(result.error).toContain("byte limit");
  expect(cancelled).toBe(true);
});
test("diagnostic bounds a stalled body and reports no successful status", async () => {
  let cancelled = false;
  const result = await check("fixture", "https://fixture.invalid", { timeoutMs: 20, fetcher: (async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }))) as unknown as typeof fetch });
  expect(result.error).toContain("deadline");
  expect(result.status).toBeUndefined();
  expect(cancelled).toBe(true);
});
