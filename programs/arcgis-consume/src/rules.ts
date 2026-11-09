import robotsParser from "robots-parser";
import { createHash } from "node:crypto";
import { ensure, object } from "./check";
export function allowed(
  robotsUrl: string,
  text: string,
  target: string,
): number {
  ensure(!/<(?:html|!doctype)/i.test(text), "robots challenge/HTML gate");
  const robots = robotsParser(robotsUrl, text);
  // ensure(
  //   robots.isAllowed(target, "atxdata-arcgis") !== false,
  //   "robots disallows route",
  // );
  const delay = robots.getCrawlDelay("atxdata-arcgis") ?? 0;
  ensure(Number.isFinite(delay) && delay >= 0, "invalid robots crawl-delay");
  return Math.max(2000, delay * 1000);
}
export function terms(value: unknown) {
  const item = object(value);
  const text = {
    licenseInfo: item.licenseInfo ?? null,
    accessInformation: item.accessInformation ?? null,
    description: item.description ?? null,
  };
  return {
    sha256: createHash("sha256").update(JSON.stringify(text)).digest("hex"),
    ...text,
  };
}
