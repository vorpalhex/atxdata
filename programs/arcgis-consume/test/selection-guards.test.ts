import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { Archive } from "../src/archive";
import { terms } from "../src/rules";
import { configs } from "../src/sources";
const id = "d".repeat(32),
  g = "e".repeat(32),
  url =
    "https://gis.traviscountytx.gov/server1/rest/services/Fixture/FeatureServer";
const fields = [{ name: "FID", alias: "ID", type: "esriFieldTypeOID" }];
const layer = {
  id: 7,
  objectIdField: "FID",
  geometryType: "esriGeometryPoint",
  maxRecordCount: 1,
  extent: {
    xmin: 0,
    ymin: 0,
    xmax: 1,
    ymax: 1,
    spatialReference: { wkid: 4326 },
  },
  fields,
  advancedQueryCapabilities: {
    supportsPagination: true,
    supportsOrderBy: true,
  },
};
const item = {
  id,
  access: "public",
  title: "Fixture",
  type: "Feature Service",
  url,
  modified: 1,
};
async function exercise(fault: string, extra: string[] = []) {
  const root = await mkdtemp(join(process.env.TMPDIR!, "guards-"));
  let now = 0,
    queries = 0,
    calls = 0,
    serviceReads = 0;
  const deps = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    fetch: async (s: string) => {
      calls++;
      const u = new URL(s);
      if (u.pathname.endsWith("robots.txt"))
        return new Response("User-agent: *\n", {
          headers: fault === "cooldown" ? { "Retry-After": "4" } : {},
        });
      if (u.pathname.endsWith("/search"))
        return Response.json({
          total: 1,
          nextStart: -1,
          results: [
            {
              ...item,
              ...(fault === "ssrf"
                ? { url: "https://127.0.0.1/FeatureServer" }
                : {}),
            },
          ],
        });
      if (u.pathname.endsWith(configs.tnr.site + "/data"))
        return Response.json({
          catalogV2: {
            scopes: { item: { filters: [{ predicates: [{ group: [g] }] }] } },
          },
        });
      if (u.pathname.endsWith(configs.tnr.site))
        return Response.json({
          id: configs.tnr.site,
          title: "Hub",
          access: "public",
        });
      if (u.pathname.includes("/content/items/")) return Response.json(item);
      if (u.pathname.endsWith("/query")) {
        queries++;
        if (u.searchParams.has("returnCountOnly"))
          return Response.json({
            count: fault === "count" && queries > 3 ? 2 : 1,
          });
        if (u.searchParams.has("returnIdsOnly"))
          return Response.json({
            objectIdFieldName: "FID",
            objectIds: [fault === "ids" && queries > 3 ? 2 : 1],
          });
        return Response.json({
          geometryType: layer.geometryType,
          spatialReference: layer.extent.spatialReference,
          fields,
          features: [
            {
              attributes: { FID: fault === "duplicate" ? 2 : 1 },
              geometry: { x: 0, y: 0 },
            },
          ],
        });
      }
      if (u.pathname.endsWith("/7"))
        return Response.json({
          ...layer,
          ...(fault === "schema" && queries > 3
            ? { fields: [{ ...fields[0], alias: "changed" }] }
            : {}),
        });
      serviceReads++;
      return Response.json({
        layers: [{ id: 7 }],
        serviceItemId:
          fault === "service" && serviceReads > 1 ? "changed" : "original",
      });
    },
  };
  const args = [
    "collect",
    "--source",
    "tnr",
    "--item",
    id,
    "--layer",
    "7",
    "--archive",
    root,
    "--terms-sha256",
    terms(item).sha256,
    ...extra,
  ];
  try {
    return { result: await main(args, deps), root, calls, queries, now };
  } catch (error) {
    return { error, root, calls, queries, now };
  }
}
test("CLI rejects identity, schema, count and catalog service changes without a completed collection", async () => {
  for (const fault of [
    "ssrf",
    "count",
    "ids",
    "duplicate",
    "schema",
    "service",
  ]) {
    const r = await exercise(fault);
    expect(r.error).toBeDefined();
    const a = await Archive.open(r.root, {
      fetch: async () => {
        throw new Error("no network");
      },
    });
    expect(a.store.completed()).toHaveLength(0);
    await a.close();
  }
});
test("offline verification rejects missing catalog provenance even when hashes/history of remaining files agree", async () => {
  const r = await exercise("none");
  expect(r.error).toBeUndefined();
  const a = await Archive.open(r.root);
  a.store.db.exec(
    "DELETE FROM versions WHERE label='catalog'; DELETE FROM observations WHERE label='catalog'",
  );
  await a.close();
  await expect(
    main(["verify", "--archive", r.root], {
      fetch: async () => {
        throw new Error("unexpected network");
      },
    }),
  ).rejects.toThrow("checkpoint");
});
test("operator budgets stop without hidden retries and successful cooldowns remain stricter than spacing", async () => {
  const r = await exercise("none", ["--max-requests", "2"]);
  expect(r.error).toBeDefined();
  expect(r.calls).toBe(2);
  const ok = await exercise("cooldown");
  expect(ok.error).toBeUndefined();
  expect(ok.now).toBeGreaterThan(8_000);
});
