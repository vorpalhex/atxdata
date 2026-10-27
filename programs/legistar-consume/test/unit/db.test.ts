import { afterEach, beforeEach, expect, test } from "bun:test";
import { AppDatabase } from "../../src/storage/db";
import type { AppConfig } from "../../src/config";
import type { DocumentManifestEntry, NormalizedItem, NormalizedMeeting } from "../../src/types";

const config: AppConfig = {
  legistarClient: "test", apiBase: "http://127.0.0.1:1", portalBase: "http://127.0.0.1:1",
  databasePath: ":memory:", documentStorePath: "unused", runsPath: "unused", userAgent: "test",
  httpTimeoutMs: 100, downloadConcurrencyNormal: 1, downloadConcurrencyBackfill: 1,
  backfillMeetingDelayMs: 0, maxDownloadRetries: 0,
};
const meeting: NormalizedMeeting = {
  eventId: 7, eventGuid: "event-guid", bodyId: 3, bodyName: "Council", meetingDate: "2026-05-21",
  meetingTime: "10 AM", location: "City Hall", agendaStatus: "Final", minutesStatus: "Draft",
  portalUrl: "https://example.test/meeting", agendaUrl: "https://example.test/agenda",
  agendaPacketUrl: "https://example.test/packet", minutesUrl: "https://example.test/minutes",
};
const item: NormalizedItem = {
  eventItemId: 4, eventItemGuid: "item-guid", eventId: 7, agendaSequence: 0, minutesSequence: 2,
  agendaNumber: "1", title: "Budget", matterId: 5, matterGuid: "matter-guid", matterFile: "26-100",
  matterName: "Budget matter", matterType: "Resolution", matterStatus: "Approved",
};
const entry: DocumentManifestEntry = {
  eventId: 7, eventItemId: 4, matterId: 5, matterFile: "26-100", attachmentId: 8,
  attachmentGuid: "attachment-guid", agendaNumber: "1", kind: "matter_attachment", title: "Budget",
  sourceUrl: "https://example.test/file", sourceType: "api", required: true,
};
let db: AppDatabase;
beforeEach(() => { db = new AppDatabase(config); db.migrate(); db.upsertMeeting(meeting); });
afterEach(() => db.db.close());

test("schema migration and meeting/item upserts are repeatable and update persisted fields", () => {
  db.migrate();
  db.upsertMeeting({ ...meeting, bodyName: "Updated Council", agendaUrl: null });
  db.upsertItem(item);
  db.upsertItem({ ...item, title: "Amended budget", matterStatus: null });
  expect(db.db.query("SELECT body_name, agenda_url FROM meetings").all()).toEqual([
    { body_name: "Updated Council", agenda_url: null },
  ]);
  expect(db.db.query("SELECT * FROM meeting_items").all()).toEqual([{
    event_item_id: 4, event_item_guid: "item-guid", event_id: 7, agenda_sequence: 0, minutes_sequence: 2,
    agenda_number: "1", title: "Amended budget", matter_id: 5, matter_guid: "matter-guid", matter_file: "26-100",
    matter_name: "Budget matter", matter_type: "Resolution", matter_status: null,
  }]);
});

test("document rediscovery preserves download state and stable id while refreshing metadata", () => {
  expect(db.getDocumentBySourceUrl(entry.sourceUrl)).toBeNull();
  const id = db.upsertDocument(entry);
  expect(db.getDocumentBySourceUrl(entry.sourceUrl)).toEqual({
    ...entry, id, downloadStatus: "pending", storagePath: null, sha256: null, byteSize: null,
  });
  db.markDownloaded(id, { httpStatus: 200, contentType: "application/pdf", byteSize: 0, sha256: "hash", storagePath: "file.pdf" });
  expect(db.upsertDocument({ ...entry, title: "Revised", required: false, sourceType: "scrape" })).toBe(id);
  expect(db.getDocumentBySourceUrl(entry.sourceUrl)).toEqual({
    ...entry, id, title: "Revised", required: false, sourceType: "scrape", downloadStatus: "downloaded",
    storagePath: "file.pdf", sha256: "hash", byteSize: 0,
  });
});

test("failed downloads record status and successful retry clears the error", () => {
  const id = db.upsertDocument({ ...entry, required: false });
  db.markFailed(id, "Unavailable", 503);
  expect(db.db.query("SELECT download_status, error, http_status FROM documents").get()).toEqual({
    download_status: "failed", error: "Unavailable", http_status: 503,
  });
  db.markFailed(id, "Network");
  expect(db.db.query("SELECT http_status FROM documents").get()).toEqual({ http_status: null });
  db.markFailed(id, "Explicit zero", 0);
  expect(db.db.query("SELECT http_status FROM documents").get()).toEqual({ http_status: 0 });
  db.markDownloaded(id, { httpStatus: 200, contentType: null, byteSize: 9, sha256: "digest", storagePath: "document.bin" });
  expect(db.db.query("SELECT error, download_status FROM documents").get()).toEqual({ error: null, download_status: "downloaded" });
});

test("runs persist completion, including absent and empty error values", () => {
  db.createRun("one", "meeting");
  expect(db.db.query("SELECT mode, status FROM ingest_runs WHERE id='one'").get()).toEqual({ mode: "meeting", status: "running" });
  db.finishRun("one", "succeeded");
  db.createRun("two", "backfill"); db.finishRun("two", "failed", "");
  db.createRun("three", "retry"); db.finishRun("three", "failed", "oops");
  expect(db.db.query("SELECT id, status, error FROM ingest_runs ORDER BY id").all()).toEqual([
    { id: "one", status: "succeeded", error: null },
    { id: "three", status: "failed", error: "oops" },
    { id: "two", status: "failed", error: "" },
  ]);
  expect(db.db.query("SELECT COUNT(*) AS n FROM ingest_runs WHERE finished_at IS NOT NULL").get()).toEqual({ n: 3 });
});

test("checkpoints replace their value without duplicating the run/key pair", () => {
  db.setCheckpoint("run", "last", { eventId: 7 });
  db.setCheckpoint("run", "last", { eventId: 8 });
  expect(db.db.query("SELECT run_id, checkpoint_key, checkpoint_value_json FROM job_checkpoints").all()).toEqual([
    { run_id: "run", checkpoint_key: "last", checkpoint_value_json: '{"eventId":8}' },
  ]);
});

test("meeting foreign keys reject documents and items with unknown events", () => {
  expect(() => db.upsertDocument({ ...entry, eventId: 99 })).toThrow();
  expect(() => db.upsertItem({ ...item, eventId: 99 })).toThrow();
});
