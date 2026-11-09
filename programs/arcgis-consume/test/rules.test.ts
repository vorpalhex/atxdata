import { test, expect } from "bun:test";
import { allowed } from "../src/rules";
test("robots longest-match rules, agent groups and stricter crawl-delay are respected", () => {
  expect(
    allowed(
      "https://www.arcgis.com/robots.txt",
      "User-agent: *\nDisallow: /private\nAllow: /private/open\nCrawl-delay: 7",
      "https://www.arcgis.com/private/open",
    ),
  ).toBe(7000);
  expect(() =>
    allowed(
      "https://www.arcgis.com/robots.txt",
      "User-agent: *\nDisallow: /sharing/",
      "https://www.arcgis.com/sharing/rest/search",
    ),
  ).toThrow("robots");
  expect(() =>
    allowed(
      "https://www.arcgis.com/robots.txt",
      "<html>Challenge</html>",
      "https://www.arcgis.com/sharing/rest/search",
    ),
  ).toThrow();
});
