import { test, expect } from "bun:test";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
test("native HTTP streaming completes without unhandled pipe cancellation errors", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            for (let i = 0; i < 4; i++) {
              controller.enqueue(
                new TextEncoder().encode(
                  i === 0 ? '{"a":"' : i === 3 ? '"}' : "value",
                ),
              );
              await Bun.sleep(2);
            }
            controller.close();
          },
        }),
      ),
  });
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-native-"));
  const a = await Archive.open(root);
  a.store.source("test", "fixture", "http://localhost");
  const run = a.store.start("test", "test");
  try {
    expect(await a.request(run, "native", server.url.href, "json")).toEqual({
      a: "valuevalue",
    });
    await Bun.sleep(10);
  } finally {
    await a.close();
    server.stop(true);
    await rm(root, { recursive: true });
  }
});
test("native gzip responses retain complete decompressed originals", async () => {
  const payload = { a: "x".repeat(30000) };
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(gzipSync(JSON.stringify(payload)), {
        headers: {
          "content-encoding": "gzip",
          "content-type": "application/json",
        },
      }),
  });
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-gzip-"));
  let now = 0;
  const a = await Archive.open(root, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  a.store.source("test", "fixture", "http://localhost");
  const run = a.store.start("test", "test");
  try {
    for (let i = 0; i < 20; i++)
      expect(
        await a.request(run, "gzip-" + i, server.url.href, "json"),
      ).toEqual(payload);
    await Bun.sleep(20);
  } finally {
    await a.close();
    server.stop(true);
    await rm(root, { recursive: true });
  }
});
