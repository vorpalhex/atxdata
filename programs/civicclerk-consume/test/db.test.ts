import { expect, test } from "bun:test";
import { CivicDatabase } from "../src/storage/db";
import { makeTestDirectory } from "../../legistar-consume/test/support/temp-dir";
import { rmSync } from "node:fs";
import { join } from "node:path";

test("SQLite checkpoints survive reopening and reject a different tenant", () => {
  const root = makeTestDirectory("civic-db-");
  const path = join(root, "test.sqlite");
  const first = new CivicDatabase(path, "first");
  try { first.upsertMeeting(event); first.discover(59, file); first.downloaded(59, file, { byteSize: 12, sha256: "saved" }); }
  finally { first.close(); }
  expect(() => new CivicDatabase(path, "second")).toThrow("tenant");
  const reopened = new CivicDatabase(path, "first");
  try {
    expect(reopened.document(59, file)).toMatchObject({ downloadStatus: "downloaded", byteSize: 12, sha256: "saved" });
    expect(reopened.db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally { reopened.close(); rmSync(root, { recursive: true, force: true }); }
});

const event = { id: 59, eventName: "Court", eventDate: "2021-01-05T09:00:00Z", publishedFiles: [] };
const file = { fileId: 157, fileType: 1, type: "Agenda", name: "Final", filename: "agenda.pdf", sourceUrl: "https://example.test/file" };

test("source URL changes invalidate downloaded checkpoints without changing document identity", () => {
  const store = new CivicDatabase(":memory:", "tenant");
  try {
    store.upsertMeeting(event);
    expect(store.document(59, file)).toBeUndefined();
    store.discover(59, file);
    store.downloaded(59, file, { byteSize: 12, sha256: "old" });
    const changed = { ...file, sourceUrl: "https://example.test/replaced" };
    store.discover(59, changed);
    expect(store.document(59, file)).toEqual({ filename: file.filename, sourceUrl: changed.sourceUrl, downloadStatus: "pending", byteSize: null, sha256: null });
    expect(store.db.query("SELECT count(*) AS n FROM documents").get()).toEqual({ n: 1 });
    store.downloaded(59, changed, { byteSize: 15, sha256: "new" });
    store.discover(59, changed);
    expect(store.document(59, file)).toMatchObject({ downloadStatus: "downloaded", byteSize: 15, sha256: "new" });
  } finally { store.close(); }
});

test("run states preserve empty errors and distinguish unfinished from completed runs", () => {
  const store = new CivicDatabase(":memory:", "tenant");
  try {
    store.upsertMeeting(event);
    const run = store.startRun(59);
    expect(store.db.query("SELECT status,finished_at,error FROM ingest_runs WHERE id=?").get(run)).toEqual({ status: "running", finished_at: null, error: null });
    store.finishRun(run, "failed", "");
    expect(store.db.query("SELECT status,error,finished_at IS NOT NULL AS finished FROM ingest_runs WHERE id=?").get(run)).toEqual({ status: "failed", error: "", finished: 1 });
    const success = store.startRun(59);
    expect(success).not.toBe(run);
    store.finishRun(success, "succeeded");
    expect(store.db.query("SELECT status,error,finished_at IS NOT NULL AS finished FROM ingest_runs WHERE id=?").get(success)).toEqual({ status: "succeeded", error: null, finished: 1 });
    expect(() => store.startRun(60)).toThrow();
  } finally { store.close(); }
});

test("empty archives bind their tenant before any meetings exist and use WAL", () => {
  const root = makeTestDirectory("civic-empty-db-");
  const path = join(root, "test.sqlite");
  const store = new CivicDatabase(path, "first");
  try { expect(store.db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" }); }
  finally { store.close(); }
  try {
    expect(() => new CivicDatabase(path, "second")).toThrow("tenant");
    const reopened = new CivicDatabase(path, "first");
    reopened.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("SQLite upserts preserve downloads and record failed runs", () => {
  const store = new CivicDatabase(":memory:", "https://example.test/v1/");
  try {
    store.upsertMeeting(event);
    const run = store.startRun(59);
    store.discover(59, file);
    expect(store.document(59, file)?.downloadStatus).toBe("pending");
    store.downloaded(59, file, { byteSize: 12, sha256: "digest" });
    store.discover(59, { ...file, name: "Updated" });
    expect(store.document(59, file)).toMatchObject({ downloadStatus: "downloaded", byteSize: 12, sha256: "digest" });
    store.discover(59, { ...file, filename: "renamed.pdf" });
    expect(store.document(59, file)).toMatchObject({ downloadStatus: "pending", sha256: null, byteSize: null });
    store.failed(59, file, "broken");
    expect(store.document(59, file)?.downloadStatus).toBe("failed");
    store.downloaded(59, file, { byteSize: 13, sha256: "new" });
    expect(store.db.query("SELECT error FROM documents").get()).toEqual({ error: null });
    store.finishRun(run, "failed", "broken");
    expect(store.db.query("SELECT status,error FROM ingest_runs").get()).toEqual({ status: "failed", error: "broken" });
    store.upsertMeeting({ ...event, eventName: "Updated Court" });
    expect(store.db.query("SELECT event_name FROM meetings").get()).toEqual({ event_name: "Updated Court" });
    expect(() => store.discover(60, file)).toThrow();
    expect(store.db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  } finally { store.close(); }
});
