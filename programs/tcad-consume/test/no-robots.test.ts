import { test, expect } from "bun:test";
import { Store } from "../src/store";
import { discover, acquire } from "../src/live";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
test("discovery acquisition reopen and cache ignore absent or obsolete robots state without transfers", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "tcad-no-robots-"));
  let s = await Store.open(join(root, "out")),
    now = 100000;
  const calls: string[] = [];
  const zip = Bun.spawnSync([
    "python3",
    "-c",
    "import io,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('STATE_CD.TXT','001'); z.close(); sys.stdout.buffer.write(b.getvalue())",
  ]).stdout;
  const options = {
    maxRequests: 1,
    maxBytes: 4096,
    clock: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    transport: async (url: string) => {
      calls.push(url);
      if (url.endsWith("/robots.txt"))
        throw new Error("robots transfer forbidden");
      return new Response(
        url.endsWith("publicinformation")
          ? "<a href=/wp-content/largefiles/current.zip>Current</a>"
          : new Uint8Array(zip),
      );
    },
  };
  try {
    const links = await discover(s.db, s.root, options);
    await acquire(s.db, s.root, links[0]!.id, options);
    expect(calls).toEqual([
      "https://traviscad.org/publicinformation",
      links[0]!.url,
    ]);
    expect(now).toBe(103000);
    s.db.query("UPDATE request_policy SET delay_ms=10000").run();
    await discover(s.db, s.root, options);
    await discover(s.db, s.root, options);
    expect(now).toBe(109000);
    for (const robots of [
      null,
      "User-agent: *\nDisallow: /\nCrawl-delay: invalid",
      42,
    ]) {
      s.db.query("UPDATE request_policy SET robots=?").run(robots);
      await s.close();
      s = await Store.open(join(root, "out"));
      expect((await acquire(s.db, s.root, links[0]!.id, options)).reused).toBe(
        true,
      );
    }
    expect(calls).toHaveLength(4);
  } finally {
    await s.close();
    await rm(root, { recursive: true, force: true });
  }
});
