import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
import { Adapter } from "../src/adapter";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
import { layer, page } from "./geometry.test";
test("robots /query disallow is enforced before any feature query", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-denied-"));
  let queries = 0,
    now = 0;
  const a = await Archive.open(root, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: async (url) => {
      if (url.endsWith("/robots.txt"))
        return new Response(
          "User-agent: *\nDisallow: /server1/rest/services/Boundaries_and_Jurisdictions/Travis_County_Commissioner_Precincts/FeatureServer/0/query",
        );
      if (url.includes("/query?")) {
        queries++;
        return Response.json({ count: 0 });
      }
      return Response.json(
        url.includes("/sharing/rest/")
          ? item
          : new URL(url).pathname.endsWith("/0")
            ? layer
            : {
                layers: [
                  { id: 0, name: "Travis_County_Commissioner_Precincts" },
                ],
              },
      );
    },
  });
  await expect(
    new Adapter(a).execute("tnr", "collect", {
      termsSha256: terms(item).sha256,
    }),
  ).rejects.toThrow("robots");
  expect(queries).toBe(0);
  await a.close();
  await rm(root, { recursive: true });
});
export const item = {
  id: configs.tnr.item,
  title: "Travis County Commissioner Precincts",
  access: "public",
  type: "Feature Service",
  url: configs.tnr.service,
  licenseInfo: "Reference purposes only",
  description: "Synthetic integration fixture",
};
test("headless TNR collection reconciles rows and reruns/offline verification send zero requests", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-adapter-"));
  let calls = 0,
    now = 0;
  const a = await Archive.open(root, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: async (url) => {
      calls++;
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\n");
      const u = new URL(url);
      let value: unknown;
      if (url.startsWith("https://www.arcgis.com/sharing/rest/content/items/"))
        value = item;
      else if (u.pathname.endsWith("/query"))
        value = u.searchParams.has("returnCountOnly")
          ? { count: 1 }
          : u.searchParams.has("returnIdsOnly")
            ? { objectIdFieldName: "OBJECTID", objectIds: [5] }
            : page();
      else if (u.pathname.endsWith("/0")) value = layer;
      else
        value = {
          serviceItemId: "not-the-catalog-id",
          layers: [{ id: 0, name: "Travis_County_Commissioner_Precincts" }],
        };
      return Response.json(value);
    },
  });
  const adapter = new Adapter(a);
  const result = await adapter.execute("tnr", "collect", {
    termsSha256: terms(item).sha256,
  });
  expect(result.summary).toMatchObject({ records: 1, ids: [5] });
  const before = calls;
  const duplicate = await adapter.execute("tnr", "collect", {
    termsSha256: terms(item).sha256,
  });
  expect(duplicate.run).toBe(result.run);
  expect(calls).toBe(before);
  expect((await adapter.verify()).httpRequests).toBe(0);
  expect(calls).toBe(before);
  expect(a.store.integrity().foreignKeys).toEqual([]);
  await a.close();
  await rm(root, { recursive: true });
});
