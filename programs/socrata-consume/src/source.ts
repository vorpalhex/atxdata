export const origin = "https://datahub.austintexas.gov";
export const catalogOrigin = origin;
export const operationFormat = "socrata-v3-catalog-decision";
export function validateIdentity(value: unknown) {
  ensure(
    value !== "socrata-v1",
    "unsupported old source identity; reviewed migration required",
  );
  ensure(
    value === operationFormat || value === "socrata-v2-datahub",
    "unsupported operation identity/representation",
  );
}
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
export function object(value: unknown): Record<string, unknown> {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "expected object",
  );
  return value as Record<string, unknown>;
}
export function positive(value: unknown, name: string, minimum = 1): number {
  ensure(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum,
    `invalid ${name}`,
  );
  return value;
}
export function sourceString(
  value: unknown,
  pattern: RegExp,
  message: string,
): string {
  ensure(typeof value === "string", message);
  ensure(pattern.test(value), message);
  return value;
}
export function assetID(value: unknown): string {
  return sourceString(value, /^[a-z0-9]{4}-[a-z0-9]{4}$/, "invalid asset ID");
}
function rejectDuplicateKeys(text: string) {
  const stack: (Set<string> | null)[] = [];
  const tokens = text.matchAll(
    /"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
  );
  for (const match of tokens) {
    const token = match[0];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (
      token.startsWith('"') &&
      /^\s*:/.test(text.slice(match.index! + token.length))
    ) {
      const keys = stack[stack.length - 1];
      ensure(keys, "invalid JSON key context");
      const key: string = JSON.parse(token);
      ensure(!keys.has(key), "duplicate JSON object key");
      keys.add(key);
    }
  }
}
export function lossless(text: string): unknown {
  // JSON number tokens become their exact source lexeme, including exponent/scale.
  // Quoted tokens are matched first and retained byte-for-byte.
  const protectedNumbers = text.replace(
    /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (token) => (token.startsWith('"') ? token : JSON.stringify(token)),
  );
  JSON.parse(text); // Validate original grammar, not just transformed grammar.
  rejectDuplicateKeys(text);
  return JSON.parse(protectedNumbers);
}
function slices(text: string): string[] {
  const result: string[] = [];
  let depth = 0,
    start = 0;
  // Quoted tokens are atomic: their escaped braces never affect object depth.
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}]/g)) {
    if (token[0] === "{") {
      if (depth === 0) start = token.index!;
      depth++;
    } else if (token[0] === "}") {
      depth--;
      if (depth === 0) result.push(text.slice(start, token.index! + 1));
    }
  }
  return result;
}
export type SourceRow = {
  id: string;
  raw: string;
  value: Record<string, unknown>;
};
export function decodeRows(text: string): SourceRow[] {
  const parsed = JSON.parse(text);
  ensure(Array.isArray(parsed), "expected resource array");
  const raw = slices(text);
  ensure(raw.length === parsed.length, "expected row objects");
  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const original = object(parsed[i]),
      value = object(lossless(entry));
    ensure(
      typeof original[":id"] === "string" && original[":id"].length > 0,
      "missing string row ID",
    );
    const id = original[":id"];
    ensure(!seen.has(id), "duplicate row ID");
    seen.add(id);
    return { id, raw: entry, value };
  });
}
export type Selection = { asset: string; maxRows: number; pageSize: number };
export function selection(value: unknown): Selection {
  const options = object(value);
  ensure(
    !(options.asset !== undefined && options.preset !== undefined),
    "choose asset or preset",
  );
  ensure(
    options.preset === undefined || options.preset === "echeckbook",
    "unknown preset",
  );
  return {
    asset: assetID(options.preset ? "8c6z-qnmj" : options.asset),
    maxRows: positive(options.maxRows, "maxRows"),
    pageSize: positive(options.pageSize ?? 10000, "pageSize"),
  };
}
export function resourceURL(
  asset: string,
  offset: number,
  limit: number,
): string {
  const url = new URL(`${origin}/resource/${assetID(asset)}.json`);
  url.search = new URLSearchParams({
    $select: "*, :id",
    $order: ":id",
    $offset: String(positive(offset, "offset", 0)),
    $limit: String(positive(limit, "limit")),
  }).toString();
  return url.href;
}
