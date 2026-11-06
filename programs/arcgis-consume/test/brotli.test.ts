import { test, expect } from "bun:test";
import { brotliCompressSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
test("native Brotli robots transfer and rejected HTML leave no asynchronous pipe error", async () => {
  const text =
    "User-agent: *\n\nSitemap: http://static.arcgis.com/sitemap.xml\n";
  const server = Bun.serve({
    port: 0,
    fetch: (r) =>
      r.url.endsWith("bad")
        ? new Response("<html>404</html>", { status: 404 })
        : new Response(brotliCompressSync(text), {
            headers: { "content-type": "text/plain", "content-encoding": "br" },
          }),
  });
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-br-"));
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
    for (let i = 0; i < 10; i++) {
      expect(await a.request(run, "br-" + i, server.url.href, "text")).toBe(
        text,
      );
      await expect(
        a.request(run, "bad-" + i, server.url.href + "bad", "text"),
      ).rejects.toThrow("404");
    }
    await Bun.sleep(20);
  } finally {
    await a.close();
    server.stop(true);
    await rm(root, { recursive: true });
  }
});
