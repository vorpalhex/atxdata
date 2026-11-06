import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
import { Adapter } from "../src/adapter";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
test("bounded discovery uses current voter group predicates and metadata only, including adjacent excluded catalog subjects", async () => {
  const group = "16f087181c9b4ccb9e42ad3fb7c78c3e",
    item = {
      id: configs.voter.item,
      title: "Election Precincts",
      access: "public",
      licenseInfo: "synthetic",
    };
  let query = "",
    now = 0;
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-discover-"));
  const a = await Archive.open(root, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: async (url) => {
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\n");
      const u = new URL(url);
      if (u.pathname.endsWith("/search")) {
        query = u.searchParams.get("q")!;
        return Response.json({
          total: 1,
          nextStart: -1,
          results: [
            {
              id: "a".repeat(32),
              title: "Address Points",
              type: "Feature Service",
              url: "https://example.invalid/excluded",
            },
          ],
        });
      }
      if (u.pathname.endsWith("/data"))
        return Response.json({
          catalog: { groups: [group] },
          catalogV2: {
            scopes: {
              item: { filters: [{ predicates: [{ group: [group] }] }] },
            },
          },
        });
      return Response.json(
        u.pathname.endsWith(configs.voter.site)
          ? { id: configs.voter.site, title: "Voter hub", access: "public" }
          : item,
      );
    },
  });
  try {
    const adapter = new Adapter(a);
    expect((await adapter.execute("voter", "rules")).summary).toMatchObject({
      source: "voter",
    });
    const r = await adapter.execute("voter", "discover", {
      termsSha256: terms(item).sha256,
    });
    expect(r.summary).toMatchObject({ catalogItems: 1 });
    expect(query).toBe("group:" + group);
    expect(a.store.status().observations).toBe(7);
    await expect(
      adapter.execute("voter", "sync", { termsSha256: "0".repeat(64) }),
    ).rejects.toThrow("terms changed");
  } finally {
    await a.close();
    await rm(root, { recursive: true });
  }
});
