import { expect, test } from "bun:test";
import { extensionFromContentType, sanitizeSegment } from "../../src/util/strings";

test("content types are matched as case-insensitive media types, not substrings", () => {
  expect(extensionFromContentType("APPLICATION/PDF; charset=binary")).toBe(".pdf");
  expect(extensionFromContentType("application/not-pdf")).toBe("");
});

test("content type mappings cover supported Office, text and unknown media types", () => {
  for (const [contentType, extension] of [
    ["application/pdf", ".pdf"], ["application/msword", ".doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
    ["application/vnd.ms-excel", ".xls"], ["text/html", ".html"], ["text/plain", ".txt"],
    ["application/octet-stream", ""], ["", ""], [null, ""], [" text/plain ; charset=utf-8", ".txt"],
  ] as const) expect(extensionFromContentType(contentType)).toBe(extension);
});

test("sanitization normalizes accents, separators, ampersands and bounds length", () => {
  expect(sanitizeSegment("  Café & Parks___../2026  ")).toBe("cafe-and-parks___..-2026");
  expect(sanitizeSegment("!!!A / / B!!!")).toBe("a-b");
  expect(sanitizeSegment("x".repeat(150))).toBe("x".repeat(120));
  expect(sanitizeSegment("😀", "Safe Fallback")).toBe("safe-fallback");
  expect(sanitizeSegment(null)).toBe("untitled");
  expect(sanitizeSegment(undefined)).toBe("untitled");
});

test("sanitizeSegment returns filesystem-safe names", () => {
  expect(sanitizeSegment("City Council 5/21/2026")).toBe("city-council-5-21-2026");
  expect(sanitizeSegment("Recommendation for Action")).toBe("recommendation-for-action");
});

test("sanitizeSegment never returns traversal segments, including unsafe fallbacks", () => {
  for (const input of [".", "..", "---", "", null, undefined]) {
    expect(sanitizeSegment(input, "../")).toBe("untitled");
  }
});

