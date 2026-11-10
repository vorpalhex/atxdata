import { test, expect } from "bun:test";
import { main } from "../src/cli";
import { Database } from "bun:sqlite";
import type { Archive } from "../src/archive";
import { unavailablePolicy, sourcePolicy } from "../src/profile-policy";
import { waterCatalog } from "../src/water";
import { configs, itemUrl } from "../src/sources";
test("offline help exposes city/Water selectors and unresolved acquisition scope", async () => {
  const help = await main(["--help"]);
  expect(help).toContain("Sources: tnr, voter, austin, water");
  expect(help).toContain("Water real acquisition remains pending");
  expect(help).toContain("PropertyProfile/FloodPro");
});
const city = "https://services.arcgis.com/robots.txt",
  water = "https://services1.arcgis.com/robots.txt";
function policy(source?: string, rows: Record<string, unknown>[] = []) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE attempts(id TEXT,run TEXT,label TEXT,url TEXT,status INTEGER,finished TEXT,error TEXT,bytes INTEGER,started TEXT)",
  );
  for (const [i, row] of rows.entries())
    db.query("INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)").run(
      String(i),
      "run",
      "robots-" + new URL(row.url as string).hostname,
      row.url as string,
      row.status as number,
      row.finished as string,
      row.error as string,
      row.bytes as number,
      String(i),
    );
  const archive = {
    store: {
      db,
      options: () => (source === undefined ? undefined : { source }),
      notBefore: () => 0,
    },
  } as unknown as Archive;
  return { archive, db };
}
const good = {
  url: city,
  status: 403,
  finished: "2026-01-01T00:00:00Z",
  error: "HTTP 403",
  bytes: 0,
};
test("source policy pairs exact source and authority, handles absent generic options, and preserves both version markers", () => {
  for (const source of [undefined, "tnr", "voter", "austin", "water"]) {
    const f = policy(source, [good, { ...good, url: water }]);
    expect(Boolean(unavailablePolicy(f.archive, "run", city))).toBe(
      source === "austin",
    );
    expect(Boolean(unavailablePolicy(f.archive, "run", water))).toBe(
      source === "water",
    );
    const result: any = sourcePolicy(f.archive, "run");
    if (source === "austin" || source === "water")
      expect(result.sourcePolicy).toMatchObject({
        version: 1,
        unavailable: [{ version: 1, status: 403, bodyRetained: false }],
      });
    else expect(result).toEqual({});
    f.db.close();
  }
});
test("read-only policy receipt rejects each independently corrupt attempt field and binds newest completed failure", () => {
  for (const change of [
    { finished: null },
    { error: "different failure" },
    { bytes: 1 },
  ]) {
    const f = policy("austin", [{ ...good, ...change }]);
    expect(() => unavailablePolicy(f.archive, "run", city)).toThrow(
      "invalid unavailable robots attempt binding",
    );
    f.db.close();
  }
  const f = policy("austin", [good, good]);
  expect(unavailablePolicy(f.archive, "run", city)?.attempt).toBe("1");
  f.db
    .query("UPDATE attempts SET url=? WHERE id='0'")
    .run(city + "?unexpected");
  expect(() => unavailablePolicy(f.archive, "run", city)).toThrow(
    "invalid unavailable robots attempt binding",
  );
  f.db.close();
});
const map = "a".repeat(32),
  id = "b".repeat(32),
  url =
    "https://services1.arcgis.com/PuB3FWUAxkScvfQy/arcgis/rest/services/Public/FeatureServer/3";
const layer = {
  itemId: id,
  url,
  title: "Public",
  layerType: "ArcGISFeatureLayer",
};
function reader(
  layers: unknown[] = [layer],
  official: unknown = '<a href="https://www.arcgis.com/apps/dashboards/' +
    configs.water.site +
    '">Water</a>',
): Archive["request"] {
  return async (_r, _l, u) => {
    if (u === configs.water.hub) return official;
    if (u === itemUrl(map))
      return { id: map, title: "Map", type: "Web Map", access: "public" };
    if (u === itemUrl(map, true)) return { operationalLayers: layers };
    throw Error("unexpected map request");
  };
}
const dashboard = (ids: unknown[]) => ({
  desktopView: {
    widgets: ids.map((itemId) => ({ type: "mapWidget", itemId })),
  },
});
test("Water map bounds reject empty/oversized catalogs and accept exact bound without guessing IDs", async () => {
  expect(
    (await waterCatalog(reader(), "run", dashboard([map]), 1)).catalogItems,
  ).toBe(1);
  for (const ids of [[], [map, id]])
    await expect(
      waterCatalog(reader(), "run", dashboard(ids), 1),
    ).rejects.toThrow("Water web map budget/identity");
  for (const bad of [7, "not-an-id"])
    await expect(
      waterCatalog(reader(), "run", dashboard([bad]), 1),
    ).rejects.toThrow("invalid Water web map ID");
});
test("Water discovery rejects missing official association and malformed item IDs but skips genuinely unlinked layers", async () => {
  for (const official of [false, "unrelated link"])
    await expect(
      waterCatalog(reader([layer], official), "run", dashboard([map]), 1),
    ).rejects.toThrow("official Water dashboard association changed");
  for (const itemId of [7, "invalid"])
    await expect(
      waterCatalog(reader([{ ...layer, itemId }]), "run", dashboard([map]), 1),
    ).rejects.toThrow("invalid Water layer item ID");
  const result = await waterCatalog(
    reader([
      { ...layer, itemId: undefined },
      { ...layer, layerType: "OtherLayer" },
    ]),
    "run",
    dashboard([map]),
    1,
  );
  expect(result.items).toEqual([]);
});
test("Water catalog retains distinct publisher item identities sharing one service URL", async () => {
  const result = await waterCatalog(
    reader([layer, { ...layer, itemId: "c".repeat(32) }]),
    "run",
    dashboard([map]),
    1,
  );
  expect(result.items.map((entry) => entry.id)).toEqual([id, "c".repeat(32)]);
});
