import { Archive } from "./archive";
import { ensure, integer, object, same } from "./check";
import { itemUrl, sharing, validateItem } from "./sources";
import { validateZip, UnsupportedShapefile } from "./zip";
import type { Selection } from "./selection";
function publishedItem(value: unknown, s: Selection) {
  const item = validateItem(value, s.item);
  ensure(
    typeof item.name === "string" &&
      /^[A-Za-z0-9_(). -]+\.[A-Za-z0-9]+$/.test(item.name) &&
      !item.name.startsWith("."),
    "unsafe/missing advertised filename",
  );
  integer(item.size, 1, s.budget.zipBytes);
  integer(item.created, 0, Number.MAX_SAFE_INTEGER);
  integer(item.modified, 0, Number.MAX_SAFE_INTEGER);
  return item;
}
function redirect(value: unknown, name: unknown) {
  const location = object(value).location;
  ensure(typeof location === "string", "missing published redirect");
  const u = new URL(location);
  ensure(
    u.protocol === "https:" &&
      u.hostname === "www.arcgis.com" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.hash &&
      u.pathname.startsWith("/itemdata/") &&
      decodeURIComponent(u.pathname.split("/").at(-1)!) === name &&
      !/%2f|%5c|%2e/i.test(u.pathname),
    "unexpected signed redirect authority/path",
  );
  return location;
}
async function validateFile(
  bytes: unknown,
  item: Record<string, unknown>,
  s: Selection,
) {
  ensure(
    bytes instanceof Uint8Array && bytes.length === item.size,
    "published bytes/size mismatch",
  );
  ensure(
    !/^\s*<(?:!doctype|html)/i.test(
      Buffer.from(bytes.subarray(0, 256)).toString(),
    ),
    "published HTML/challenge is not data",
  );
  if (item.type !== "Shapefile")
    return {
      semanticStatus: "opaque-unsupported",
      format: item.type,
      bytes: bytes.length,
      records: null,
    };
  ensure(
    String(item.name).toLowerCase().endsWith(".zip"),
    "Shapefile item is not an advertised ZIP",
  );
  try {
    return {
      semanticStatus: "validated-shapefile",
      ...(await validateZip(bytes, bytes.length, {
        basename: String(item.name).slice(0, -4),
        rawBytes: s.budget.zipBytes,
        expandedBytes: s.expandedBytes,
        maxRecords: s.maxRecords,
        maxMembers: s.maxMembers,
      })),
    };
  } catch (error) {
    if (!(error instanceof UnsupportedShapefile)) throw error;
    return {
      semanticStatus: "unsupported",
      format: "Shapefile",
      records: null,
      bytes: bytes.length,
      scope: error.message,
    };
  }
}
export async function acquirePublished(
  a: Archive,
  run: string,
  s: Selection,
  value: unknown,
) {
  const item = publishedItem(value, s),
    entry = `${sharing}/content/items/${s.item}/data`;
  if (!a.store.observation(run, "published-file")) {
    const response = await a.request(run, "published-entry", entry, "file");
    if (response instanceof Uint8Array) await validateFile(response, item, s);
    else
      await a.request(
        run,
        "published-file",
        redirect(response, item.name),
        "file",
        (v) => validateFile(v, item, s),
      );
  }
  await a.request(run, "item-after", itemUrl(s.item), "json", (v) =>
    ensure(
      same(item, publishedItem(v, s)),
      "published item changed during observation",
    ),
  );
}
export async function verifyPublished(
  a: Archive,
  run: string,
  s: Selection,
  value: unknown,
) {
  const item = publishedItem(value, s);
  const label = a.store.observation(run, "published-file")
    ? "published-file"
    : "published-entry";
  const row = a.store.observation(run, label)!;
  if (label === "published-file") redirect({ location: row.url }, item.name);
  else
    ensure(
      row.url === `${sharing}/content/items/${s.item}/data`,
      "published source URL mismatch",
    );
  const body = await a.read(run, label);
  return {
    strategy: "catalog-published-file",
    catalogItem: s.item,
    sourceUrl: `${sharing}/content/items/${s.item}/data`,
    name: item.name,
    ...(await validateFile(body, item, s)),
    publicationDate: null,
  };
}
