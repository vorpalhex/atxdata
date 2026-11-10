import {
  assetID,
  object,
  ensure,
  positive,
  origin,
  catalogOrigin,
  lossless,
  sourceString,
} from "./source";
import { hash } from "./transport";
export function catalogURL(options: {
  asset?: string;
  query?: string;
  limit: number;
  offset: number;
}) {
  const url = new URL(catalogOrigin + "/api/catalog/v1");
  const params = new URLSearchParams({
    domains: new URL(origin).hostname,
    limit: String(positive(options.limit, "catalog limit")),
    offset: String(positive(options.offset, "catalog offset", 0)),
    only: "datasets",
  });
  if (options.asset !== undefined) params.set("ids", assetID(options.asset));
  if (options.query !== undefined) {
    ensure(
      options.query.trim().length > 0 && options.query.length <= 500,
      "invalid catalog query",
    );
    params.set("q", options.query);
  }
  url.search = params.toString();
  return url.href;
}
export type Asset = { id: string; name: string; link: string };
export function decodeCatalog(
  text: string,
  limit: number,
): { assets: Asset[]; total: string } {
  const body = object(lossless(text));
  ensure(
    Array.isArray(body.results) && body.results.length <= limit,
    "catalog response limit/shape",
  );
  const assets = body.results.map((value) => {
    const item = object(value),
      resource = object(item.resource),
      metadata = object(item.metadata);
    ensure(
      metadata.domain === new URL(origin).hostname,
      "catalog domain mismatch",
    );
    ensure(resource.type === "dataset", "unsupported catalog asset type");
    const id = assetID(resource.id);
    ensure(typeof resource.name === "string", "missing catalog name");
    ensure(typeof item.link === "string", "catalog link mismatch");
    const link = new URL(item.link);
    ensure(
      link.origin === origin &&
        !link.username &&
        !link.password &&
        !link.search &&
        !link.hash &&
        link.pathname.endsWith("/" + id),
      "catalog link mismatch",
    );
    return { id, name: resource.name, link: item.link };
  });
  ensure(
    new Set(assets.map((a) => a.id)).size === assets.length,
    "duplicate catalog asset",
  );
  return { assets, total: decimal(body.resultSetSize) };
}
function decimal(value: unknown): string {
  return sourceString(value, /^(0|[1-9]\d*)$/, "invalid decimal count");
}
export function decodeCount(text: string): string {
  const body = lossless(text);
  ensure(Array.isArray(body) && body.length === 1, "invalid count response");
  const row = object(body[0]);
  ensure(Object.keys(row).length === 1, "invalid count fields");
  return decimal(row.count);
}
export type Schema = {
  id: string;
  name: string;
  columns: Record<string, unknown>[];
  raw: Record<string, unknown>;
};
export function decodeSchema(text: string, expected: string): Schema {
  const raw = object(lossless(text));
  ensure(raw.id === assetID(expected), "schema identity mismatch");
  ensure(
    raw.viewType === "tabular" && typeof raw.name === "string",
    "unsupported non-tabular schema",
  );
  ensure(
    raw.rowsUpdatedAt !== undefined &&
      Array.isArray(raw.columns) &&
      raw.columns.length > 0,
    "missing schema revision/columns",
  );
  const columns = raw.columns.map((value) => {
    const column = object(value);
    ensure(
      typeof column.fieldName === "string" &&
        typeof column.dataTypeName === "string",
      "invalid schema column",
    );
    return column;
  });
  ensure(
    new Set(columns.map((c) => c.fieldName)).size === columns.length,
    "duplicate schema field",
  );
  return { id: expected, name: raw.name, columns, raw };
}
export function revision(schema: Schema) {
  const raw = schema.raw;
  return hash(
    JSON.stringify({
      id: schema.id,
      columns: schema.columns,
      rowsUpdatedAt: raw.rowsUpdatedAt,
      viewLastModified: raw.viewLastModified ?? null,
      publicationDate: raw.publicationDate ?? null,
    }),
  );
}
export const schemaURL = (id: string) =>
  `${origin}/api/views/${assetID(id)}.json`;
export function countURL(id: string) {
  const url = new URL(`${origin}/resource/${assetID(id)}.json`);
  url.searchParams.set("$select", "count(*)");
  return url.href;
}
