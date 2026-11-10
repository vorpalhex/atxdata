import { array, ensure, object } from "./check";
import { configs, itemUrl, validateItem } from "./sources";
import { serviceRoute } from "./catalog";
import type { Archive } from "./archive";

type Entry = Record<string, unknown>;
function mapIds(data: unknown, maxMaps: number) {
  const widgets = array(object(object(data).desktopView).widgets);
  const maps = [
    ...new Set(
      widgets
        .map(object)
        .filter((w) => w.type === "mapWidget")
        .map((w) => w.itemId),
    ),
  ];
  ensure(
    maps.length > 0 && maps.length <= maxMaps,
    "Water web map budget/identity",
  );
  return maps.map((id) => {
    ensure(
      typeof id === "string" && /^[a-f0-9]{32}$/.test(id),
      "invalid Water web map ID",
    );
    return id;
  });
}
function layers(body: unknown) {
  const pending = [...array(object(body).operationalLayers)],
    result: Entry[] = [];
  while (pending.length) {
    const layer = object(pending.shift());
    if (layer.layerType === "GroupLayer")
      pending.unshift(...array(layer.layers));
    else if (
      layer.layerType === "ArcGISFeatureLayer" &&
      layer.itemId !== undefined
    )
      result.push(layer);
  }
  return result;
}
function entry(layer: Entry, map: string) {
  const id = layer.itemId;
  ensure(
    typeof id === "string" && /^[a-f0-9]{32}$/.test(id),
    "invalid Water layer item ID",
  );
  const route = serviceRoute(layer.url);
  ensure(
    route.layer !== undefined,
    "Water map layer needs advertised numeric ID",
  );
  return {
    id,
    title: layer.title,
    type: "Feature Service",
    url: route.original,
    map,
  };
}
async function readMap(request: Archive["request"], run: string, id: string) {
  const map = validateItem(
    await request(run, "water-map-" + id, itemUrl(id), "json"),
    id,
  );
  ensure(map.type === "Web Map", "Water reference is not a public web map");
  return request(run, "water-map-data-" + id, itemUrl(id, true), "json");
}
// Follow only explicitly published map widgets and item-linked layers. Never
// execute widgets or their chart expressions. Originals retain all aliases.
export async function waterCatalog(
  request: Archive["request"],
  run: string,
  data: unknown,
  maxMaps: number,
) {
  const official = await request(
    run,
    "water-official",
    configs.water.hub,
    "text",
  );
  ensure(
    typeof official === "string" &&
      official.includes(
        "https://www.arcgis.com/apps/dashboards/" + configs.water.site,
      ),
    "official Water dashboard association changed",
  );
  const entries = new Map<string, Entry>();
  for (const id of mapIds(data, maxMaps)) {
    for (const layer of layers(await readMap(request, run, id))) {
      const value = entry(layer, id);
      entries.set(value.id + ":" + value.url, value);
    }
  }
  return {
    items: [...entries.values()],
    query: "official-dashboard-web-maps",
    catalogItems: entries.size,
    source: "water",
    scope:
      "complete explicitly item-linked feature layers in dashboard web maps; not unlinked layers, chart or historical completeness",
  };
}
