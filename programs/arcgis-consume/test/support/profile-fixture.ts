import { fixture, id, item, service } from "./selection-fixture";
import { configs } from "../../src/sources";
export { id, item };
export const city =
  "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/Fixture/FeatureServer";
export const water =
  "https://services1.arcgis.com/PuB3FWUAxkScvfQy/arcgis/rest/services/Fixture/FeatureServer";
export function profileFixture(
  source: "austin" | "water",
  policy: Response | string,
) {
  const f = fixture(),
    original = f.deps.fetch;
  const base = source === "water" ? water : city,
    map = "b".repeat(32);
  const calls: string[] = [];
  f.deps.fetch = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (url === new URL(base).origin + "/robots.txt")
      return typeof policy === "string" ? new Response(policy) : policy.clone();
    if (source === "water") {
      if (url === configs.water.hub)
        return new Response(
          '<a href="https://www.arcgis.com/apps/dashboards/' +
            configs.water.site +
            '">Water</a>',
        );
      if (u.pathname.endsWith(configs.water.site))
        return Response.json({
          id: configs.water.site,
          title: "Dashboard",
          access: "public",
          type: "Dashboard",
        });
      if (u.pathname.endsWith(configs.water.site + "/data"))
        return Response.json({
          desktopView: { widgets: [{ type: "mapWidget", itemId: map }] },
        });
      if (u.pathname.endsWith(map))
        return Response.json({
          id: map,
          title: "Map",
          access: "public",
          type: "Web Map",
        });
      if (u.pathname.endsWith(map + "/data"))
        return Response.json({
          operationalLayers: [
            {
              itemId: id,
              url: base + "/7",
              title: "Published layer",
              layerType: "ArcGISFeatureLayer",
            },
          ],
        });
    }
    const response = await original(
      url.replace(configs.austin.site, configs.tnr.site).replace(base, service),
    );
    if (url.endsWith("robots.txt")) return response;
    return new Response(
      (await response.text())
        .replaceAll(configs.tnr.site, configs.austin.site)
        .replaceAll(service, base),
      { status: response.status, headers: response.headers },
    );
  };
  return { deps: f.deps, calls, base };
}
