import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Archive, type Kind } from "../src/archive";
test("explicit raw policy capture preserves original301 and binary bytes", async () => {
  const raw = Buffer.from([0, 255, 254, 60, 104, 116, 109, 108, 62]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(raw, {
        status: 301,
        headers: {
          location: "https://geohub.austintexas.gov/",
          "content-length": String(raw.length),
        },
      });
    },
  });
  const root = await mkdtemp(join(process.env.TMPDIR!, "raw-policy-"));
  const a = await Archive.open(root);
  a.store.source("fixture", "fixture", "https://example.invalid");
  const run = a.store.start("fixture", "inspect-policy");
  a.store.saveOptions(run, {
    mode: "wrapper-policy-v1",
    policyReceiptVersion: 1,
    budget: {
      requests: 1,
      totalBytes: 1000,
      responseBytes: 1000,
      zipBytes: 1000,
      retries: 0,
    },
  });
  try {
    const got = await a.request(
      run,
      "policy-hop-0",
      server.url.href,
      "policy-raw-v1" as Kind,
    );
    expect(Buffer.isBuffer(got)).toBe(true);
    expect(got).toEqual(raw);
    const attempt = a.store.db
      .query("SELECT status,bytes,error FROM attempts")
      .get();
    expect(attempt).toEqual({ status: 301, bytes: raw.length, error: null });
    expect(a.store.observations()[0]!.kind).toBe("policy-raw-v1");
    expect(await a.read(run, "policy-hop-0")).toEqual(raw);
  } finally {
    await a.close();
    server.stop(true);
  }
});
