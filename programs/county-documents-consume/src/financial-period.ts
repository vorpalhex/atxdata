import type { Evidence } from "./adapters";
export type TokenOrigin =
  { kind: "label" } | { kind: "heading"; index: number };
export type FiscalPeriod = { original: string; origin: TokenOrigin } & (
  | { kind: "single-year"; year: string }
  | { kind: "span"; startYear: string; endYear: string }
);
export type Quarter = {
  original: string;
  ordinal: number;
  origin: TokenOrigin;
};
type Token = { text: string; origin: TokenOrigin };
function contexts(row: Pick<Evidence, "label" | "headings">): Token[] {
  return [
    { text: row.label, origin: { kind: "label" } },
    ...row.headings.map((text, index) => ({
      text,
      origin: { kind: "heading" as const, index },
    })),
  ];
}
function periodMatch(
  match: RegExpMatchArray,
  origin: TokenOrigin,
): FiscalPeriod | null {
  const original = match[0],
    start = match[1]!;
  if (!match[2]) return { kind: "single-year", original, origin, year: start };
  const end = match[3]!;
  if (!/^\d{4}$/.test(end) || end <= start) return null;
  return { kind: "span", original, origin, startYear: start, endYear: end };
}
function periodKey(value: FiscalPeriod): string {
  return value.kind === "span"
    ? `${value.startYear}-${value.endYear}`
    : value.year;
}
function unique<T>(items: (T | null)[], key: (value: T) => string): T | null {
  if (!items.length || items.includes(null)) return null;
  const values = items as T[];
  return new Set(values.map(key)).size === 1 ? values[0]! : null;
}
export function explicitPeriod(
  row: Pick<Evidence, "label" | "headings">,
): FiscalPeriod | null {
  const values = contexts(row).flatMap(({ text, origin }) =>
    [
      ...text.matchAll(
        /\b(?:Fiscal\s+Year|FY)\s*(\d{4})(?!\d)(?:\s*([-–—/])\s*(\d*))?/gi,
      ),
    ].map((m) => periodMatch(m, origin)),
  );
  return unique(values, periodKey);
}
const ORDINALS = ["first", "second", "third", "fourth"];
export function explicitQuarter(
  row: Pick<Evidence, "label" | "headings">,
): Quarter | null {
  const values = contexts(row).flatMap(({ text, origin }) =>
    [
      ...text.matchAll(
        /\b(?:([1-4])(?:st|nd|rd|th)\s+quarter|(first|second|third|fourth)\s+quarter|Q([1-4]))\b/gi,
      ),
    ].map((m) => ({
      original: m[0],
      origin,
      ordinal:
        m[1] || m[3]
          ? Number(m[1] || m[3])
          : ORDINALS.indexOf(m[2]!.toLowerCase()) + 1,
    })),
  );
  return unique(values, (q) => String(q.ordinal));
}
export function currentFinancial(row: Evidence): Evidence {
  const fiscalPeriod = explicitPeriod(row),
    quarter = explicitQuarter(row);
  const year = fiscalPeriod?.kind === "single-year" ? fiscalPeriod.year : null;
  return { ...row, year, fiscalYear: year, fiscalPeriod, quarter };
}
export function requireCurrentFinancial(row: Evidence): void {
  if (
    row.source === "austin-financial-publications" &&
    !Object.hasOwn(row, "fiscalPeriod")
  )
    throw Error(
      "Austin new PDF acquisition requires metadata5; legacy metadata4 is read-only",
    );
}
export function financialBodyMatches(text: string, row: Evidence): boolean {
  const body = { label: text, headings: [] },
    period = explicitPeriod(body);
  if (
    !row.fiscalPeriod ||
    !period ||
    periodKey(period) !== periodKey(row.fiscalPeriod)
  )
    return false;
  if (row.quarter)
    return explicitQuarter(body)?.ordinal === row.quarter.ordinal;
  // Conflicting explicit selected quarters cannot silently become an unspecified quarter.
  return !/\b(?:[1-4](?:st|nd|rd|th)\s+quarter|(?:first|second|third|fourth)\s+quarter|Q[1-4])\b/i.test(
    [row.label, ...row.headings].join(" "),
  );
}
export function financialSelection(row: Evidence) {
  return {
    publisher: row.publisher,
    jurisdiction: row.jurisdiction,
    administeringCounty: row.administeringCounty,
    fiscalPeriod: row.fiscalPeriod,
    quarter: row.quarter,
    fiscalYear: row.fiscalYear,
  };
}
