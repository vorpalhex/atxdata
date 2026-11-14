import { load } from "cheerio";
import type { Evidence } from "./adapters";
export function cityPublication(source: string): boolean {
  return (
    source === "austin-council-archives" ||
    source === "austin-election-publications"
  );
}
export function cityPage(source: string, url: URL): boolean {
  if (url.origin !== "https://www.austintexas.gov" || url.search) return false;
  if (source === "austin-council-archives")
    return (
      /^\/council\/archive\/(?:city_council_meeting_archives|\d{4}_council_index)$/.test(
        url.pathname,
      ) ||
      /^\/council\/\d{4}\/\d{4}_master_index$/.test(url.pathname) ||
      /^\/(?:content|council)\/archive-council-meetings-held-\d{4}$/.test(
        url.pathname,
      ) ||
      /^\/council\/council(?:_committee_info_center|-corporations)$/.test(
        url.pathname,
      )
    );
  return (
    url.pathname === "/clerk/programs/elections" ||
    /^\/clerk\/[a-z]+-\d{4}-election$/.test(url.pathname) ||
    /^\/clerk\/elections\/[A-Za-z0-9-]+$/.test(url.pathname)
  );
}
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export function cityDate(
  text: string,
): { date: string; original: string } | null {
  const m = new RegExp(
    `\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`,
    "i",
  ).exec(text);
  if (!m) return null;
  const month =
    MONTHS.findIndex((x) => x.toLowerCase() === m[1]!.toLowerCase()) + 1;
  const date = `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  const d = new Date(date + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date
    ? { date, original: m[0] }
    : null;
}
const ELECTION_ROLES: [RegExp, string][] = [
  [/\belection notice\b/i, "election-notice"],
  [/\bofficial (?:returns|results)\b/i, "official-returns"],
  [/\bsample ballot\b/i, "sample-ballot"],
  [/\bnotice of drawing\b/i, "ballot-drawing-notice"],
  [/\bnotice of deadline\b/i, "ballot-filing-notice"],
  [/\border of place\b/i, "ballot-order"],
  [/\belection calendar\b/i, "election-calendar"],
  [/\bcandidate packet\b/i, "candidate-packet"],
];
function cityRole(row: Evidence): string | null {
  if (row.source !== "austin-council-archives")
    return (
      ELECTION_ROLES.find(([pattern]) => pattern.test(row.label))?.[1] ?? null
    );
  if (/\bminutes\b/i.test(row.label)) return "minutes";
  return /\bmeeting\b/i.test(row.label) ? "meeting-record" : null;
}
function labelYear(
  label: string,
  date: ReturnType<typeof cityDate>,
): string | null {
  return date?.date.slice(0, 4) ?? /\b(\d{4})\b/.exec(label)?.[1] ?? null;
}
export function cityEvidence(row: Evidence): Evidence | null {
  const role = cityRole(row);
  if (!role) return null;
  const date = cityDate(row.label);
  const year = labelYear(row.label, date);
  return {
    ...row,
    publisher: "City of Austin",
    jurisdiction: "City of Austin",
    administeringCounty: null,
    year,
    date: date?.date ?? null,
    originalDate: date?.original ?? null,
    role,
    cityIdentity: {
      profile: row.source,
      dateOrigin: date ? { kind: "label", original: date.original } : null,
      roleOrigin: { kind: "label", original: row.label },
      yearOrigin: year ? { kind: "label", original: year } : null,
    },
  };
}
export function requireCityEvidence(row: Evidence): void {
  if (!cityPublication(row.source)) return;
  const checks = [
    row.publisher === "City of Austin",
    row.jurisdiction === "City of Austin",
    row.administeringCounty === null,
    row.fiscalYear === null,
    row.taxYear === null,
    row.cityIdentity?.profile === row.source,
    Boolean(row.cityIdentity?.roleOrigin),
    row.date !== null,
    row.cityIdentity?.dateOrigin?.original === row.originalDate,
  ];
  if (!checks.every(Boolean))
    throw Error("City publication metadata6 identity unresolved");
}
export function requireCityBody(text: string, row: Evidence): void {
  requireCityEvidence(row);
  const title = text.slice(0, 512).replace(/\s+/g, " ").trim();
  const roles: Record<string, RegExp> = {
    minutes: /\bcity council\b.*\bminutes\b/i,
    "meeting-record": /\bcity council\b.*\bminutes\b/i,
    "election-notice": /\belection notice\b/i,
    "official-returns": /\bofficial (?:returns|results)\b/i,
    "sample-ballot": /\bsample ballot\b/i,
  };
  if (
    !/^City of Austin\b/i.test(title) ||
    !roles[row.role]?.test(title) ||
    cityDate(title)?.date !== row.date
  )
    throw Error(
      "City publication PDF body identity unresolved; original retained unvalidated, no county fallback",
    );
}
export function citySelection(row: Evidence) {
  return {
    publisher: row.publisher,
    jurisdiction: row.jurisdiction,
    administeringCounty: row.administeringCounty,
    cityIdentity: row.cityIdentity,
  };
}
export function requireCityTextOnly(row: Evidence): void {
  if (cityPublication(row.source))
    throw Error(
      "City publication requires text identity; county rendered review unsupported",
    );
}

export function cityContent(html: string, enabled: boolean): string {
  if (!enabled) return html;
  const $ = load(html);
  $("aside,footer,header,nav").remove();
  const roots = $("article,main").filter(
    (_, node) => $(node).parents("article,main").length === 0,
  );
  return roots.length
    ? roots
        .map((_, node) => $.html(node))
        .get()
        .join("\n")
    : $.html();
}
