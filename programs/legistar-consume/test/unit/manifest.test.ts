import { expect, test } from "bun:test";
import { dedupeManifest } from "../../src/ingest/manifest";
import type { DocumentManifestEntry } from "../../src/types";

function entry(sourceUrl: string, title: string): DocumentManifestEntry {
  return { kind: "agenda", title, sourceUrl, sourceType: "api", required: true, eventId: 1,
    eventItemId: null, matterId: null, matterFile: null, attachmentId: null, attachmentGuid: null, agendaNumber: null };
}

test("dedupeManifest retains first occurrence by exact URL, preserving order and input", () => {
  const first = entry("https://example.test/report?id=1", "First");
  const second = entry("https://example.test/report?id=2", "Second");
  const duplicate = entry(first.sourceUrl, "Different metadata");
  const caseSensitive = entry("https://example.test/Report?id=1", "Distinct path");
  const input = [first, second, duplicate, caseSensitive, second];
  const snapshot = input.slice();
  const actual = dedupeManifest(input);
  expect(actual).toEqual([first, second, caseSensitive]);
  expect(actual[0]).toBe(first);
  expect(input).toEqual(snapshot);
  expect(dedupeManifest(actual)).toEqual(actual);
});

test("dedupeManifest returns a fresh empty array for empty input", () => {
  const input: DocumentManifestEntry[] = [];
  expect(dedupeManifest(input)).toEqual([]);
  expect(dedupeManifest(input)).not.toBe(input);
});
