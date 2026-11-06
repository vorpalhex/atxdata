import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
import { Adapter } from "../src/adapter";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
import { zipFixture } from "./zip.test";
test("published strategy follows only validated temporary location; retains stable source identity and reconciles before/after metadata", async () => {
  const zip = await zipFixture();
  const item = {
    id: configs.voter.item,
    title: "Election Precincts",
    name: "Election_Precincts.zip",
    type: "Shapefile",
    access: "public",
    size: zip.length,
    created: 1,
    modified: 2,
    licenseInfo: "synthetic fixture",
  };
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-published-"));
  let now = 0,
    calls = 0;
  const a = await Archive.open(root, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: async (url) => {
      calls++;
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\n");
      if (url.includes("/itemdata/"))
        return new Response(zip, {
          headers: { "content-type": "application/zip" },
        });
      if (url.endsWith("/data"))
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://www.arcgis.com/itemdata/fixture/Election_Precincts.zip?private-test-signature=temporary",
          },
        });
      return Response.json(item);
    },
  });
  try {
    const adapter = new Adapter(a);
    const r = await adapter.execute("voter", "collect", {
      termsSha256: terms(item).sha256,
    });
    expect(r.summary).toMatchObject({ records: 1, ids: ["101"] });
    expect(calls).toBe(5);
    const before = calls;
    expect((await adapter.verify()).collections).toBe(1);
    await adapter.execute("voter", "collect");
    expect(calls).toBe(before);
    const source = a.store.db
      .query<{ original_url: string }, []>(
        "SELECT original_url FROM sources WHERE id='voter'",
      )
      .get()!;
    expect(source.original_url).toBe(
      "https://www.arcgis.com/sharing/rest/content/items/" +
        configs.voter.item +
        "/data",
    );
  } finally {
    await a.close();
    await rm(root, { recursive: true });
  }
});
