import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
async function fixture(
  status: number,
  raw: Buffer,
  headers: Record<string, string> = {},
) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(new Uint8Array(raw), {
        status,
        headers: { "content-length": String(raw.length), ...headers },
      });
    },
  });
  const a = await Archive.open(
    await mkdtemp(join(process.env.TMPDIR!, "raw-boundary-")),
  );
  a.store.source("fixture", "fixture", "https://example.invalid");
  const run = a.store.start("fixture", "inspect-policy");
  a.store.saveOptions(run, {
    mode: "wrapper-policy-v1",
    policyReceiptVersion: 1,
    budget: {
      requests: 1,
      totalBytes: 100,
      responseBytes: 100,
      zipBytes: 100,
      retries: 0,
    },
  });
  return {
    a,
    run,
    url: server.url.href,
    close: async () => {
      await a.close();
      server.stop(true);
    },
  };
}
for (const status of [200, 302, 403, 429, 500, 503])
  test(
    "raw diagnostic status stays original and has complete binary receipt " +
      status,
    async () => {
      const f = await fixture(
        status,
        Buffer.from([0, 255, 254]),
        status === 429 ? { "retry-after": "8" } : {},
      );
      try {
        const start = Date.now();
        expect(
          await f.a.request(f.run, "policy-hop-0", f.url, "policy-raw-v1"),
        ).toEqual(Buffer.from([0, 255, 254]));
        expect(
          f.a.store.db.query("SELECT status,bytes,error FROM attempts").get(),
        ).toEqual({ status, bytes: 3, error: null });
        if (status === 429)
          expect(f.a.store.notBefore()).toBeGreaterThanOrEqual(start + 8000);
      } finally {
        await f.close();
      }
    },
  );
test("raw byte ceiling failure holds rather than becoming policy", async () => {
  const f = await fixture(301, Buffer.alloc(101), {
    location: "https://geohub.austintexas.gov/",
  });
  try {
    await expect(
      f.a.request(f.run, "policy-hop-0", f.url, "policy-raw-v1"),
    ).rejects.toThrow();
    expect(f.a.store.observations().length).toBe(0);
    expect(f.a.store.notBefore()).toBe(Number.MAX_SAFE_INTEGER);
  } finally {
    await f.close();
  }
});
test("raw stream failure holds independently of status/error strings", async () => {
  const a = await Archive.open(
    await mkdtemp(join(process.env.TMPDIR!, "raw-error-")),
    {
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull(c) {
              c.error(new Error("authored stream failure"));
            },
          }),
          { status: 403, headers: { "transfer-encoding": "chunked" } },
        ),
    },
  );
  a.store.source("fixture", "fixture", "https://example.invalid");
  const run = a.store.start("fixture", "inspect-policy");
  a.store.saveOptions(run, {
    mode: "wrapper-policy-v1",
    policyReceiptVersion: 1,
    budget: { retries: 0 },
  });
  try {
    await expect(
      a.request(
        run,
        "policy-hop-0",
        "https://example.invalid",
        "policy-raw-v1",
      ),
    ).rejects.toThrow();
    expect(a.store.notBefore()).toBe(Number.MAX_SAFE_INTEGER);
    expect(a.store.observations().length).toBe(0);
  } finally {
    await a.close();
  }
});
test("raw kind rejects missing intent before fetch", async () => {
  let calls = 0;
  const a = await Archive.open(
    await mkdtemp(join(process.env.TMPDIR!, "raw-intent-")),
    {
      fetch: async () => {
        calls++;
        return new Response("x");
      },
    },
  );
  a.store.source("fixture", "fixture", "https://example.invalid");
  const run = a.store.start("fixture", "rules");
  try {
    await expect(
      a.request(
        run,
        "policy-hop-0",
        "https://example.invalid",
        "policy-raw-v1",
      ),
    ).rejects.toThrow("intent");
    expect(calls).toBe(0);
  } finally {
    await a.close();
  }
});
