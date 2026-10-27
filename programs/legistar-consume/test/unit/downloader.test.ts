import { join } from "node:path";
import { expect, test } from "bun:test";
import { buildStoragePath } from "../../src/ingest/downloader";
import type { DocumentManifestEntry, NormalizedMeeting } from "../../src/types";

const meeting: NormalizedMeeting = {
  eventId: 4072,
  eventGuid: null,
  bodyId: null,
  bodyName: "City Council",
  meetingDate: "2026-05-21",
  meetingTime: null,
  location: null,
  agendaStatus: null,
  minutesStatus: null,
  portalUrl: null,
  agendaUrl: null,
  agendaPacketUrl: null,
  minutesUrl: null,
};

test("buildStoragePath tags meeting documents by event and document kind", () => {
  const entry = documentEntry({
    kind: "agenda_packet",
    title: "Agenda Packet",
    sourceUrl: "https://example.test/packet",
  });

  expect(buildStoragePath("test-output/import", meeting, entry, "application/pdf", new Headers())).toBe(
    join(
      "test-output/import",
      "city-council-meeting",
      "2026-05-21",
      "meeting-documents",
      "agenda-packet",
      "agenda-packet_event-4072.pdf",
    ),
  );
});

test("buildStoragePath tags agenda item attachments by item number and matter file", () => {
  const entry = documentEntry({
    title: "Recommendation for Action",
    sourceUrl: "https://example.test/attachment",
    eventItemId: 9001,
    matterId: 1806,
    matterFile: "26-1806",
    attachmentId: 82900,
    agendaNumber: "1.",
  });

  expect(buildStoragePath("test-output/import", meeting, entry, "application/pdf", new Headers())).toBe(
    join(
      "test-output/import",
      "city-council-meeting",
      "2026-05-21",
      "agenda_item_1",
      "matter-file-26-1806",
      "attachment-documents",
      "attachment-82900_recommendation-for-action.pdf",
    ),
  );
});

test("malformed encoded disposition falls back to its basic filename", () => {
  const headers = new Headers({ "content-disposition": `attachment; filename*=UTF-8''bad%ZZ.pdf; filename="safe.doc"` });
  expect(buildStoragePath("test-output", meeting, documentEntry({}), "application/pdf", headers)).toEndWith(".doc");
});

test("untrusted meeting dates and filename suffixes cannot create path segments", () => {
  const headers = new Headers({ "content-disposition": 'attachment; filename="evil.pdf\\\\escape"' });
  const path = buildStoragePath("test-output", { ...meeting, meetingDate: "../../outside" }, documentEntry({}), "application/pdf", headers);
  expect(path).toStartWith("test-output/city-council-meeting/..-..-outside/");
  expect(path).toEndWith(".pdf");
});

test("storage path extension precedence preserves disposition, URL, media type and binary fallback", () => {
  for (const [sourceUrl, header, contentType, suffix] of [
    ["https://example.test/file.pdf?download=1", 'attachment; filename="chosen.doc"', "application/pdf", ".doc"],
    ["https://example.test/file.pdf", "attachment; filename=chosen.xlsx", null, ".xlsx"],
    ["https://example.test/file.pdf", "attachment; filename*=UTF-8''chosen%2Edocx", null, ".docx"],
    ["https://example.test/file.pdf", null, "application/msword", ".pdf"],
    ["https://example.test/download", null, "text/plain", ".txt"],
    ["https://example.test/", null, null, ".bin"],
    ["not a URL", null, "application/pdf", ".pdf"],
    ["not a URL", "attachment; filename*=UTF-8''bad%ZZ", null, ".bin"],
    ["https://example.test/file.pdf", "attachment; filename*=UTF-8''%2Epdf", "text/plain", ".txt"],
    ["https://example.test/file.pdf", "attachment; filename=no-extension", "application/msword", ".doc"],
  ] as const) {
    const headers = new Headers();
    if (header) headers.set("content-disposition", header);
    expect(buildStoragePath("test-output", meeting, documentEntry({ sourceUrl }), contentType, headers)).toEndWith(suffix);
  }
});

test("meeting kinds and attachment identifier fallbacks retain folder conventions", () => {
  for (const kind of ["agenda", "minutes"] as const) {
    expect(buildStoragePath("test-output", meeting, documentEntry({ kind }), null, new Headers())).toBe(`test-output/city-council-meeting/2026-05-21/meeting-documents/${kind}/attachment_event-4072.pdf`);
  }
  expect(buildStoragePath("test-output", meeting, documentEntry({}), null, new Headers())).toBe("test-output/city-council-meeting/2026-05-21/agenda_item_unknown/matter-id-unknown/attachment-documents/attachment-unknown_attachment.pdf");
  expect(buildStoragePath("test-output", meeting, documentEntry({ eventItemId: 9, matterId: 10, attachmentId: 11 }), null, new Headers())).toBe("test-output/city-council-meeting/2026-05-21/agenda_item_9/matter-id-10/attachment-documents/attachment-11_attachment.pdf");
  expect(buildStoragePath("test-output", meeting, documentEntry({ agendaNumber: "..." }), null, new Headers())).toContain("/agenda_item_unknown/");
});

test("attachment paths distinguish empty agenda numbers and zero IDs from absent values", () => {
  const zeroIds = documentEntry({ eventItemId: 0, matterId: 0, attachmentId: 0 });
  expect(buildStoragePath("test-output", meeting, zeroIds, null, new Headers())).toBe("test-output/city-council-meeting/2026-05-21/agenda_item_0/matter-id-0/attachment-documents/attachment-0_attachment.pdf");
  expect(buildStoragePath("test-output", meeting, { ...zeroIds, agendaNumber: "" }, null, new Headers())).toContain("/agenda_item_unknown/");
});

test("encoded disposition filename without an extension takes precedence over a URL suffix", () => {
  const headers = new Headers({ "content-disposition": "attachment; filename*=UTF-8''plain" });
  expect(buildStoragePath("test-output", meeting, documentEntry({}), "application/msword", headers)).toEndWith(".doc");
});

function documentEntry(overrides: Partial<DocumentManifestEntry>): DocumentManifestEntry {
  return {
    kind: "matter_attachment",
    title: "Attachment",
    sourceUrl: "https://example.test/file.pdf",
    sourceType: "api",
    required: true,
    eventId: meeting.eventId,
    eventItemId: null,
    matterId: null,
    matterFile: null,
    attachmentId: null,
    attachmentGuid: null,
    agendaNumber: null,
    ...overrides,
  };
}
