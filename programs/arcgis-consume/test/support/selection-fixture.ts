import { configs } from "../../src/sources";
export const id = "d".repeat(32),
  group = "e".repeat(32);
export const service =
  "https://gis.traviscountytx.gov/server1/rest/services/Fixture/FeatureServer";
const fields = [
  { name: "FID", type: "esriFieldTypeOID", alias: "Identity" },
  { name: "LABEL", type: "esriFieldTypeString", alias: "Name" },
];
export const sr = { wkid: 4326 };
export const layer = {
  id: 7,
  name: "Other layer",
  objectIdField: "FID",
  geometryType: "esriGeometryPoint",
  hasZ: false,
  hasM: false,
  maxRecordCount: 4,
  capabilities: "Query",
  advancedQueryCapabilities: {
    supportsPagination: true,
    supportsOrderBy: true,
  },
  extent: { xmin: 0, ymin: 0, xmax: 20, ymax: 20, spatialReference: sr },
  fields,
  editingInfo: { lastEditDate: 10 },
};
export const item = {
  id,
  access: "public",
  type: "Feature Service",
  title: "Other item",
  url: service,
  modified: 10,
  licenseInfo: "Synthetic fixtures only",
};
export function fixture(nonpaged = false) {
  let now = 0,
    calls = 0,
    interrupt = false;
  const deps = {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    fetch: async (url: string) => {
      calls++;
      const u = new URL(url);
      if (u.pathname.endsWith("robots.txt"))
        return new Response("User-agent: *\n");
      if (u.pathname.endsWith("/search"))
        return Response.json(
          u.searchParams.get("start") === "1"
            ? {
                total: 2,
                nextStart: 2,
                results: [{ id: "a".repeat(32), title: "Other" }],
              }
            : { total: 2, nextStart: -1, results: [item] },
        );
      if (u.pathname.endsWith(configs.tnr.site + "/data"))
        return Response.json({
          catalogV2: {
            scopes: {
              item: { filters: [{ predicates: [{ group: [group] }] }] },
            },
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
        if (u.searchParams.has("returnCountOnly"))
          return Response.json({ count: 13 });
        if (u.searchParams.has("returnIdsOnly"))
          return Response.json({
            objectIdFieldName: "FID",
            objectIds: Array.from({ length: 13 }, (_, i) => i + 1),
          });
        const offset = Number(u.searchParams.get("resultOffset") ?? 0);
        if (interrupt && offset === 4) throw new Error("fixture interruption");
        const ids = u.searchParams.has("objectIds")
          ? u.searchParams.get("objectIds")!.split(",").map(Number).reverse()
          : Array.from(
              { length: Math.min(4, 13 - offset) },
              (_, i) => offset + i + 1,
            );
        return Response.json({
          geometryType: layer.geometryType,
          spatialReference: sr,
          fields,
          exceededTransferLimit: !nonpaged && offset + ids.length < 13,
          features: ids.map((n) => ({
            attributes: { FID: n, LABEL: `row ${n}` },
            geometry: { x: n, y: n },
          })),
        });
      }
      if (u.pathname.endsWith("/7"))
        return Response.json({
          ...layer,
          advancedQueryCapabilities: {
            supportsPagination: !nonpaged,
            supportsOrderBy: !nonpaged,
          },
        });
      return Response.json({
        layers: [{ id: 7, name: layer.name }],
        serviceItemId: "different-service-identity",
      });
    },
  };
  return {
    deps,
    get calls() {
      return calls;
    },
    set interrupt(v: boolean) {
      interrupt = v;
    },
  };
}
