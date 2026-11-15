import { test, expect } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { Engine } from "../src/engine";
import { Transport } from "../src/transport";
import { sources } from "../src/adapters";

test("direct discovery spends only page requests and ignores retained robots policy without fabricating receipts", async () => {
  const root = await realpath(
    await mkdtemp(join(process.env.TMPDIR!, "no-robots-")),
  );
  let engine = await Engine.open(root);
  let now = 10000;
  const calls: string[] = [];
  const starts: number[] = [];
  const deps = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    fetch: async (url: string) => {
      calls.push(url);
      starts.push(now);
      if (url.endsWith("/robots.txt")) throw Error("robots transfer forbidden");
      return new Response("<p>Public page</p>", {
        headers: { "content-type": "text/html", "retry-after": "7" },
      });
    },
  };
  try {
    const transport = new Transport(engine, deps, { maxRequests: 2 });
    await transport.discover("budgets", sources.budgets.pages[0]);
    const body = "Disallow: /\nCrawl-delay: broken\nRequest-rate: 1/30";
    engine.db.run("INSERT INTO robots VALUES(?,?,?,?,?)", [
      "https://www.traviscountytx.gov",
      body,
      "corrupt historical policy hash",
      999999999,
      999999999,
    ]);
    await transport.discover("budgets", sources.budgets.pages[1]);
    expect(calls).toEqual(sources.budgets.pages.slice(0, 2));
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(7000);
    expect(
      engine.db.query("SELECT 1 FROM attempts WHERE kind='robots'").get(),
    ).toBeNull();
    expect(
      engine.db
        .query<{ kind: string }, []>(
          "SELECT kind FROM runs WHERE kind LIKE 'transport-work-v1:%'",
        )
        .all()
        .every(
          (r) =>
            JSON.parse(r.kind.slice("transport-work-v1:".length))
              .acknowledgement === undefined,
        ),
    ).toBe(true);
    await engine.preflight();
    engine.db.exec(
      "PRAGMA foreign_keys=OFF; INSERT INTO robots_bindings VALUES('https://stale.invalid','stale-policy-edge','stale-policy-attempt'); PRAGMA foreign_keys=ON",
    );
    await engine.preflight();
    engine.db.exec("DROP TABLE robots_bindings; DROP TABLE robots");
    await engine.preflight();
    await engine.close();
    engine = await Engine.open(root);
    await engine.preflight();
  } finally {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  }
});
