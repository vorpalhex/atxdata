import { queryUrl } from "./sources";
import { ensure, object, array } from "./check";
import { hash } from "./policy-inspection-receipt";
import { terms } from "./rules";
export type DerivedReference = {
  index: number;
  tag: string;
  attribute: string;
  literal: string;
  url: string | null;
  sha256: string;
  role: string;
  reason: string | null;
  requiredTermsSha256?: string;
  item?: string;
  documentURL?: string;
  publishedLayerURL?: string;
};
export function referenceEntry(
  parentSha256: string,
  effectiveBase: string,
  index: number,
  role: string,
  literal: string,
  url: string,
  extra: Partial<DerivedReference> = {},
): DerivedReference {
  return {
    index,
    tag: "protocol",
    attribute: role,
    literal,
    url,
    role,
    reason: null,
    ...extra,
    sha256: hash(
      JSON.stringify({
        version: 2,
        parentSha256,
        effectiveBase,
        index,
        role,
        literal,
        url,
        ...extra,
      }),
    ),
  };
}
export function portalItem(literal: string) {
  ensure(
    typeof literal === "string" && !/[\\\u0000-\u0020\u007f]/.test(literal),
    "unsafe literal Portal item URL",
  );
  const u = new URL(literal);
  ensure(
    ["www.arcgis.com", "austin.maps.arcgis.com"].includes(u.hostname) &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash,
    "unsupported Portal item origin",
  );
  const id =
    u.pathname === "/home/item.html" && /^\?id=[a-f0-9]{32}$/.test(u.search)
      ? u.searchParams.get("id")
      : u.pathname.match(
          /^\/sharing\/rest\/content\/items\/([a-f0-9]{32})$/,
        )?.[1];
  ensure(id, "unsupported typed Portal item URL");
  return {
    id,
    origin: u.origin,
    metadata: u.origin + "/sharing/rest/content/items/" + id + "?f=json",
  };
}
export function typedAppReferences(raw: Buffer, url: string, max: number) {
  const v = object(JSON.parse(raw.toString())),
    items = array(v.items);
  ensure(
    typeof v.schemaVersion === "string" && items.length <= max,
    "unsupported app schema/item ceiling",
  );
  const refs: DerivedReference[] = [];
  items.forEach((entry, index) => {
    const item = object(entry);
    if (item.$type !== "map-extension" || item.webMap === undefined) return;
    ensure(typeof item.webMap === "string", "typed WebMap must be a URL");
    const target = portalItem(item.webMap);
    refs.push(
      referenceEntry(
        hash(raw),
        url,
        refs.length,
        "webmap-item",
        item.webMap,
        target.metadata,
        { item: target.id, attribute: `/items/${index}/webMap` },
      ),
    );
  });
  return {
    references: refs,
    typedItems: items.length,
    unresolved: refs.length === 0,
    catalogMembershipClaim: false,
    acquiredFeatures: false,
  };
}
export function protocolConfig(
  raw: Buffer,
  documentURL: string,
  helper: Buffer,
) {
  const text = raw.toString(),
    call =
      /_detectPortals\(\)[\s\S]{0,300}?await\(0,([\w$]+)\.j\)\("(\.\/auth\/portal\.json)"\)/.exec(
        text,
      );
  ensure(
    call &&
      text.includes("isPortalItemId") &&
      text.includes("fetchData()") &&
      text.includes('queryValues.get("app")'),
    "unsupported published Portal resolver protocol",
  );
  const escaped = call[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    module = new RegExp(escaped + "=[a-zA-Z_$][\\w$]*\\((\\d+)\\)").exec(text);
  ensure(module, "missing exact resolver module binding");
  const h = helper.toString(),
    start = h.indexOf(module[1] + ":"),
    section = h.slice(start, start + 14000);
  ensure(
    start >= 0 &&
      section.includes("j:()=>_") &&
      section.includes("async function _(e)") &&
      section.includes("await fetch(n)") &&
      section.includes("i.accountId&&i.appId&&i.portal"),
    "required native fetch-helper module proof missing",
  );
  const d = new URL(documentURL);
  ensure(
    d.hostname === "maps.austintexas.gov" && !d.searchParams.has("org"),
    "unsupported hosted/org resolver branch",
  );
  const app = d.searchParams.get("app");
  ensure(
    app && /^[a-f0-9]{32}$/.test(app),
    "document app query is not Portal item ID",
  );
  return {
    url: new URL(call[2]!, documentURL).href,
    literal: call[2]!,
    item: app,
    module: module[1],
    proof: {
      mainSha256: hash(raw),
      helperSha256: hash(helper),
      moduleStart: start,
      documentURL,
      role: "published-PortalItemID-fetchData",
    },
  };
}
export function portalConfigReferences(
  raw: Buffer,
  url: string,
  documentURL: string,
) {
  const v = object(JSON.parse(raw.toString()));
  ensure(
    typeof v.portal === "string" &&
      typeof v.appId === "string" &&
      typeof v.accountId === "string",
    "unsupported actual Portal config",
  );
  const origin = new URL(v.portal);
  ensure(
    origin.protocol === "https:" &&
      origin.origin === v.portal &&
      !origin.username &&
      !origin.password &&
      !origin.port &&
      (origin.hostname.endsWith(".maps.arcgis.com") ||
        origin.hostname === "www.arcgis.com"),
    "invalid declared Portal origin",
  );
  const app = new URL(documentURL).searchParams.get("app");
  ensure(app && /^[a-f0-9]{32}$/.test(app), "missing bound document app ID");
  return [
    referenceEntry(
      hash(raw),
      url,
      0,
      "portal-app-item",
      v.portal,
      v.portal + "/sharing/rest/content/items/" + app + "?f=json",
      { item: app, documentURL },
    ),
  ];
}
export function itemDataReference(
  raw: Buffer,
  url: string,
  expected: DerivedReference,
) {
  const v = object(JSON.parse(raw.toString()));
  ensure(
    v.id === expected.item &&
      v.access === "public" &&
      !v.error &&
      v.type ===
        (expected.role === "webmap-item"
          ? "Web Map"
          : "Web Mapping Application"),
    "derived public Portal item identity/type mismatch",
  );
  const u = new URL(url);
  ensure(
    u.pathname.endsWith("/" + expected.item) && u.search === "?f=json",
    "Portal metadata identity mismatch",
  );
  return referenceEntry(
    hash(raw),
    url,
    0,
    expected.role === "webmap-item" ? "webmap-data" : "portal-app-data",
    url,
    u.origin + u.pathname + "/data?f=json",
    {
      item: expected.item,
      requiredTermsSha256: terms(v).sha256,
      documentURL: expected.documentURL,
    },
  );
}

export function derivedLayerURL(value: unknown): string {
  ensure(typeof value === "string", "missing literal layer URL");
  const u = new URL(value);
  ensure(
    u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash &&
      u.href === value &&
      !/%|\\/.test(u.pathname) &&
      /\/(?:MapServer|FeatureServer)\/\d+$/.test(u.pathname) &&
      (u.hostname === "maps.austintexas.gov" ||
        (u.hostname === "services.arcgis.com" &&
          u.pathname.startsWith("/0L95CJ0VTaxqcmED/"))),
    "unsupported literal City app layer URL",
  );
  return value;
}
export function typedWebmapReferences(raw: Buffer, url: string, max: number) {
  const v = object(JSON.parse(raw.toString())),
    roots = array(v.operationalLayers),
    refs: DerivedReference[] = [];
  let visited = 0;
  function walk(n: unknown, pointer: string, depth: number) {
    ensure(depth <= 16 && ++visited <= max * 32, "WebMap structural ceiling");
    const node = object(n);
    if (typeof node.url === "string") {
      ensure(refs.length < max, "WebMap reference ceiling; no truncation");
      let role = "layer",
        reason: null | string = null;
      try {
        derivedLayerURL(node.url);
      } catch {
        role = "blocked";
        reason =
          "not a supported numeric layer URL; no layer0/service equivalence inferred";
      }
      const r = referenceEntry(
        hash(raw),
        url,
        refs.length,
        role,
        node.url,
        role === "layer" ? queryUrl(node.url, {}) : node.url,
        { attribute: pointer + "/url", publishedLayerURL: node.url },
      );
      r.reason = reason;
      refs.push(r);
    }
    if (node.layers !== undefined)
      array(node.layers).forEach((c, i) =>
        walk(c, pointer + "/layers/" + i, depth + 1),
      );
  }
  roots.forEach((r, i) => walk(r, "/operationalLayers/" + i, 0));
  return {
    references: refs,
    distinctExactURLs: new Set(
      refs.filter((r) => r.role === "layer").map((r) => r.publishedLayerURL),
    ).size,
    catalogMembershipClaim: false,
    acquiredFeatures: false,
  };
}
