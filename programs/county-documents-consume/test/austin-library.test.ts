import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Engine } from "../src/engine";
import { Transport } from "../src/transport";
import { rawFetch } from "../src/encoding";
import { cityPdf } from "./austin-fixtures";

test("library path exercises real raw loopback wire, bound policy, current reuse and full byte verification", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "austin-library-"));
  const page =
      "https://www.austintexas.gov/budget-excellence/data-and-insights",
    doc = "https://services.austintexas.gov/edims/document.cfm?id=123456";
  const pdf = cityPdf();
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      requests++;
      const url = req.headers.get("x-authored-url");
      if (url === "https://services.austintexas.gov/robots.txt")
        return new Response("canonical", {
          status: 302,
          headers: {
            location: "https://www.austintexas.gov/robots.txt",
            "content-type": "text/plain",
          },
        });
      if (url === "https://www.austintexas.gov/robots.txt")
        return new Response("User-agent: *\nAllow: /\n", {
          headers: { "content-type": "text/plain" },
        });
      if (url === page)
        return new Response(
          `<h2>FY 2031</h2><a href="${doc}">Quarterly Financial Report</a>`,
          { headers: { "content-type": "text/html" } },
        );
      if (url === doc)
        return new Response(pdf, {
          headers: { "content-type": "application/pdf" },
        });
      return new Response("unmapped", { status: 404 });
    },
  });
  const engine = await Engine.open(root);
  try {
    const transport = new Transport(engine, {
      fetch: (url, init) => {
        const headers = new Headers(init.headers);
        headers.set("x-authored-url", url);
        return rawFetch(server.url.href, { ...init, headers });
      },
    });
    await transport.discover("austin-financial-publications", page);
    const row = engine.list("austin-financial-publications", { limit: 1 })[0]!;
    const acquired = await transport.collect(row.id);
    expect((await engine.readArtifact(acquired.path)).equals(pdf)).toBe(true);
    expect(
      await engine.verify("austin-financial-publications", { limit: 1 }),
    ).toEqual({ documents: 1, versions: 1, httpRequests: 0 });
    const before = requests;
    await engine.preflight();
    expect(requests).toBe(before);
  } finally {
    await engine.close();
    server.stop(true);
  }
}, 30000);
