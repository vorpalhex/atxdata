import { test, expect } from "bun:test";
import { brotliCompressSync } from "node:zlib";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
test("TLS Brotli transfers drain completely without a detached native pipe error", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-tls-"));
  const generated = Bun.spawnSync(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(root, "key.pem"),
      "-out",
      join(root, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  expect(generated.exitCode).toBe(0);
  const cert = await readFile(join(root, "cert.pem")),
    key = await readFile(join(root, "key.pem"));
  const text =
    "User-agent: *\n\nSitemap: http://static.arcgis.com/sitemap.xml\n";
  const server = Bun.serve({
    hostname: "localhost",
    port: 0,
    tls: { cert, key },
    fetch: () =>
      new Response(brotliCompressSync(text), {
        headers: { "content-type": "text/plain", "content-encoding": "br" },
      }),
  });
  let now = 0;
  const a = await Archive.open(join(root, "archive"), {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: (url, init) => fetch(url, { ...init, tls: { ca: cert } }),
  });
  a.store.source("test", "fixture", server.url.href);
  const run = a.store.start("test", "test");
  try {
    for (let i = 0; i < 2; i++) {
      expect(await a.request(run, "tls-" + i, server.url.href, "text")).toBe(
        text,
      );
      await Bun.sleep(2100);
      Bun.gc(true);
    }
  } finally {
    await a.close();
    server.stop(true);
    await rm(root, { recursive: true });
  }
});
