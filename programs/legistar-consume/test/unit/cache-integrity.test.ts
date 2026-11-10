import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { makeTestDirectory } from "../support/temp-dir";
import { downloadDocument } from "../../src/ingest/downloader";
import { AppDatabase } from "../../src/storage/db";
import type { AppConfig } from "../../src/config";
import type { DocumentManifestEntry, NormalizedMeeting } from "../../src/types";

const roots: string[] = [];
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.db.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const logger = { info() {}, warn() {}, error() {} };
function cached() {
  const root = makeTestDirectory("legistar-cache-integrity-");
  roots.push(root);
  const config = {
    databasePath: join(root, "state.sqlite"),
    documentStorePath: join(root, "documents"),
  } as AppConfig;
  const meeting = {
    eventId: 11,
    bodyName: "City Council",
    meetingDate: "2026-01-01",
  } as NormalizedMeeting;
  const item: DocumentManifestEntry = {
    kind: "agenda",
    title: "Agenda",
    sourceUrl: "https://example.test/agenda.pdf",
    sourceType: "api",
    required: true,
    eventId: 11,
    eventItemId: null,
    matterId: null,
    matterFile: null,
    attachmentId: null,
    attachmentGuid: null,
    agendaNumber: null,
  };
  const db = new AppDatabase(config);
  databases.push(db);
  db.migrate();
  db.upsertMeeting(meeting);
  const path = join(config.documentStorePath, "agenda.pdf");
  mkdirSync(config.documentStorePath);
  const original = Buffer.from("%PDF-authored immutable original");
  writeFileSync(path, original);
  const id = db.upsertDocument(item);
  db.markDownloaded(id, {
    httpStatus: 200,
    contentType: "application/pdf",
    byteSize: original.length,
    sha256: createHash("sha256").update(original).digest("hex"),
    storagePath: path,
  });
  let requests = 0;
  const http = {
    async getJson<T>(): Promise<T> {
      throw new Error("unexpected metadata request");
    },
    async fetchWithRetry() {
      requests++;
      throw new Error("cache validation must not fetch");
    },
  };
  return {
    root,
    config,
    meeting,
    item,
    db,
    path,
    original,
    http,
    requests: () => requests,
    run: () => downloadDocument(item, meeting, db, http, config, logger),
    state: () => db.db.query("SELECT * FROM documents").all(),
  };
}

test("valid cached original is hash-verified and reused without network or document mutation", async () => {
  const f = cached();
  const before = f.state();
  expect(
    await downloadDocument(f.item, f.meeting, f.db, f.http, f.config, logger),
  ).toEqual({ status: "skipped", bytes: f.original.length });
  expect(f.requests()).toBe(0);
  expect(f.state()).toEqual(before);
});

test("same-size corrupt cached original fails without replacing bytes or mutating evidence", async () => {
  const f = cached();
  const bad = Buffer.alloc(f.original.length, 65);
  writeFileSync(f.path, bad);
  const before = f.state();
  const result = await f.run();
  expect(result.status).toBe("failed");
  if (result.status === "failed")
    expect(result.error).toContain("cached document integrity");
  expect(f.requests()).toBe(0);
  expect(readFileSync(f.path)).toEqual(bad);
  expect(f.state()).toEqual(before);
});

test("cached symlink cannot stand in for an original even when target bytes match", async () => {
  const f = cached();
  const target = join(f.root, "target.pdf");
  writeFileSync(target, f.original);
  rmSync(f.path);
  symlinkSync(target, f.path);
  const before = f.state();
  const result = await f.run();
  expect(result.status).toBe("failed");
  expect(f.requests()).toBe(0);
  expect(readFileSync(target)).toEqual(f.original);
  expect(f.state()).toEqual(before);
});

test("cached path outside the document root is refused without fetching", async () => {
  const f = cached();
  const target = join(f.root, "outside.pdf");
  writeFileSync(target, f.original);
  f.db.db.query("UPDATE documents SET storage_path = ?").run(target);
  const before = f.state();
  const result = await f.run();
  expect(result.status).toBe("failed");
  expect(f.requests()).toBe(0);
  expect(f.state()).toEqual(before);
});

test("document root cannot itself be a cached original", async () => {
  const f = cached();
  f.config.documentStorePath = f.path;
  const before = f.state();
  expect((await f.run()).status).toBe("failed");
  expect(f.requests()).toBe(0);
  expect(f.state()).toEqual(before);
});

test("nonmissing filesystem errors do not authorize reacquisition", async () => {
  const f = cached();
  f.db.db
    .query("UPDATE documents SET storage_path = ?")
    .run(join(f.path, "child.pdf"));
  const before = f.state();
  const result = await f.run();
  expect(result.status).toBe("failed");
  if (result.status === "failed") expect(result.error).toContain("ENOTDIR");
  expect(f.requests()).toBe(0);
  expect(f.state()).toEqual(before);
});

test("missing cached bytes never authorize writes through a symlink ancestor", async () => {
  for (const dangling of [false, true]) {
    const f = cached();
    const target = join(f.root, "target");
    if (!dangling) mkdirSync(target);
    const alias = join(f.config.documentStorePath, "alias");
    symlinkSync(target, alias);
    f.db.db
      .query("UPDATE documents SET storage_path = ?")
      .run(join(alias, "missing", "agenda.pdf"));
    const before = f.state();
    const result = await f.run();
    expect(result.status).toBe("failed");
    if (result.status === "failed")
      expect(result.error).toContain("symlink ancestor");
    expect(f.requests()).toBe(0);
    expect(f.state()).toEqual(before);
  }
});

test("all cached ancestors are checked even beneath ordinary directories", async () => {
  const f = cached();
  const real = join(f.config.documentStorePath, "real");
  mkdirSync(join(real, "child"), { recursive: true });
  writeFileSync(join(real, "child", "agenda.pdf"), f.original);
  const alias = join(f.config.documentStorePath, "alias");
  symlinkSync(real, alias);
  f.db.db
    .query("UPDATE documents SET storage_path = ?")
    .run(join(alias, "child", "agenda.pdf"));
  const before = f.state();
  const result = await f.run();
  expect(result.status).toBe("failed");
  if (result.status === "failed")
    expect(result.error).toContain("symlink ancestor");
  expect(f.requests()).toBe(0);
  expect(f.state()).toEqual(before);
});
