import { test, expect } from "bun:test";
import { policyFixture } from "./support/policy-fixture";
import { terms } from "../src/rules";
import { queryUrl } from "../src/sources";

// Entirely authored public-role fixtures, not captured publisher data.
test("authored reference and hosted layer chain needs no waiver or robots traffic", async () => {
  const f = await policyFixture();
  try {
    const p = await f.produce();
    const app = "1".repeat(32),
      map = "2".repeat(32);
    const document = `https://maps.austintexas.gov/Fixture/?app=${app}`;
    const portal = "https://austin.maps.arcgis.com/sharing/rest/content/items/";
    const layer =
      "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/Authored/FeatureServer/0";
    const put = (url: string, body: unknown, mime = "application/json") => {
      f.mode.routes[url] = {
        body: Buffer.from(
          typeof body === "string" ? body : JSON.stringify(body),
        ),
        mime,
      };
    };
    f.mode.status = 200;
    f.mode.body = Buffer.from(
      `<html><iframe src="${document}"></iframe></html>`,
    );
    put(
      document,
      '<html><script src="main.js"></script><script src="helper.js"></script></html>',
      "text/html",
    );
    put(
      "https://maps.austintexas.gov/Fixture/main.js",
      'm=x(123);_detectPortals();await(0,m.j)("./auth/portal.json");isPortalItemId;fetchData();queryValues.get("app")',
      "application/javascript",
    );
    put(
      "https://maps.austintexas.gov/Fixture/helper.js",
      "123:j:()=>_;async function _(e){await fetch(n)};i.accountId&&i.appId&&i.portal",
      "application/javascript",
    );
    put("https://maps.austintexas.gov/Fixture/auth/portal.json", {
      portal: "https://austin.maps.arcgis.com",
      appId: "fixture",
      accountId: "fixture",
    });
    put(portal + app + "?f=json", {
      id: app,
      access: "public",
      type: "Web Mapping Application",
    });
    put(portal + app + "/data?f=json", {
      schemaVersion: "1",
      items: [
        {
          $type: "map-extension",
          webMap: "https://austin.maps.arcgis.com/home/item.html?id=" + map,
        },
      ],
    });
    put(portal + map + "?f=json", {
      id: map,
      access: "public",
      type: "Web Map",
    });
    put(portal + map + "/data?f=json", {
      operationalLayers: [
        { id: "fixture", url: layer, layerType: "ArcGISFeatureLayer" },
      ],
    });
    const metadata = {
      id: 0,
      objectIdField: "OBJECTID",
      fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }],
      geometryType: "esriGeometryPoint",
      extent: {
        xmin: 0,
        ymin: 0,
        xmax: 10,
        ymax: 10,
        spatialReference: { wkid: 4326 },
      },
      maxRecordCount: 10,
      advancedQueryCapabilities: {
        supportsPagination: true,
        supportsOrderBy: true,
      },
    };
    put(queryUrl(layer, {}), metadata);
    put(queryUrl(layer + "/query", { where: "1=1", returnCountOnly: "true" }), {
      count: 0,
    });
    put(
      queryUrl(layer + "/query", {
        where: "1=1",
        returnIdsOnly: "true",
        returnGeometry: "false",
      }),
      { objectIdFieldName: "OBJECTID", objectIds: [] },
    );
    const invoke = async (args: string[], offline = false) => {
      const r = await f.invoke(args, offline);
      expect(r.exit, r.err).toBe(0);
      return JSON.parse(r.out);
    };
    const wrapper = await invoke(["inspect-wrapper", ...p.slice(1)]);
    const common = [
      "--source",
      "austin",
      "--archive",
      f.root,
      "--wrapper-run",
      wrapper.run,
      "--wrapper-sha256",
      wrapper.summary.capture.sha256,
    ];
    const child = async (
      parent: string,
      select: (r: any) => boolean,
      helper?: string,
    ) => {
      const args = [
        "resolve-app",
        ...common,
        "--parent-run",
        parent,
        ...(helper ? ["--helper-run", helper] : []),
      ];
      const c = await invoke(args);
      const ref = c.references.find(select);
      expect(ref).toBeDefined();
      return invoke([
        ...args,
        "--reference-sha256",
        ref.sha256,
        ...(ref.requiredTermsSha256
          ? ["--dependency-terms-sha256", ref.requiredTermsSha256]
          : []),
      ]);
    };
    const frame = await child(wrapper.run, (r) => r.role === "frame");
    const main = await child(frame.run, (r) => r.url?.endsWith("main.js"));
    const helper = await child(frame.run, (r) => r.url?.endsWith("helper.js"));
    const config = await child(
      main.run,
      (r) => r.role === "portal-config",
      helper.run,
    );
    const appItem = await child(
      config.run,
      (r) => r.role === "portal-app-item",
    );
    const data = await child(appItem.run, (r) => r.role === "portal-app-data");
    const webmap = await child(data.run, (r) => r.role === "webmap-item");
    const webmapData = await child(webmap.run, (r) => r.role === "webmap-data");
    const args = [
      "collect-app-layer",
      ...common,
      "--parent-run",
      webmapData.run,
      "--layer-url",
      layer,
      "--layer-terms-sha256",
      terms(metadata).sha256,
      "--max-requests",
      "16",
    ];
    const result = await invoke(args);
    expect(result.summary.records).toBe(0);
    expect(result.summary.waiver).toBeUndefined();
    const before = f.wire.length;
    expect((await invoke(args, true)).reused).toBe(true);
    await invoke(["verify", "--archive", f.root], true);
    expect(f.wire.length).toBe(before);
    expect(f.wire.some((r) => new URL(r.url).pathname === "/robots.txt")).toBe(
      false,
    );
  } finally {
    f.close();
  }
}, 120000);
