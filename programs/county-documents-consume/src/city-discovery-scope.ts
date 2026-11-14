import { cityPublication } from "./city-publications";

export type CityDiscoveryScope = { year?: string; date?: string };

function routeYears(url: string): string[] {
  return [
    ...new URL(url).pathname.matchAll(/(?:^|[/_-])(\d{4})(?=[/_-]|$)/g),
  ].map((match) => match[1]!);
}
function yearsAgree(years: string[], selected?: string): boolean {
  return years.every((year) => year === (selected ?? years[0]));
}
function dateYear(date?: string): string | undefined {
  if (date === undefined) return undefined;
  const parsed = new Date(date + "T00:00:00Z");
  const checks = [
    /^\d{4}-\d{2}-\d{2}$/.test(date),
    Number.isFinite(parsed.getTime()),
  ];
  if (!checks.every(Boolean)) throw Error("invalid City discovery date");
  if (parsed.toISOString().slice(0, 10) !== date)
    throw Error("invalid City discovery date");
  return date.slice(0, 4);
}
function selectedCityYear(scope: CityDiscoveryScope): string | undefined {
  if (scope.year !== undefined && !/^\d{4}$/.test(scope.year))
    throw Error("invalid City discovery year");
  const calendarYear = dateYear(scope.date);
  if (
    scope.year !== undefined &&
    calendarYear !== undefined &&
    calendarYear !== scope.year
  )
    throw Error("conflicting City discovery year");
  const selected = scope.year ?? calendarYear;
  return selected;
}
/** Pure prewriter scope check; direct Transport callers use this same boundary. */
export function cityDiscoveryScopeYear(
  source: string,
  initialPage: string,
  scope: CityDiscoveryScope,
): string | undefined {
  if (!cityPublication(source)) return scope.year ?? scope.date?.slice(0, 4);
  const selected = selectedCityYear(scope);
  if (!yearsAgree(routeYears(initialPage), selected))
    throw Error("initial City discovery page year conflicts with selection");
  return selected;
}
/** Link evidence stays in the catalog; selection never repairs a label or href. */
export function cityDiscoveryLinkSelected(
  source: string,
  link: { label: string; url: string },
  selected?: string,
): boolean {
  if (!cityPublication(source)) return true;
  const labels = link.label.match(/\b\d{4}\b/g) ?? [];
  return yearsAgree([...routeYears(link.url), ...labels], selected);
}
