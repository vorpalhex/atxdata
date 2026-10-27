import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { makeTestDirectory } from "../support/temp-dir";
import { join } from "node:path";
import type { AppConfig } from "../../src/config";
import { buildStoragePath, downloadDocument, downloadManifest } from "../../src/ingest/downloader";
import { AppDatabase } from "../../src/storage/db";
import type { DocumentManifestEntry, NormalizedMeeting } from "../../src/types";
import type { HttpClient } from "../../src/util/http";
import type { Logger } from "../../src/util/logger";

const meeting: NormalizedMeeting = {
  eventId: 4072, eventGuid: null, bodyId: null, bodyName: "City Council", meetingDate: "2026-05-21",
  meetingTime: null, location: null, agendaStatus: null, minutesStatus: null, portalUrl: null,
  agendaUrl: null, agendaPacketUrl: null, minutesUrl: null,
};
const logger: Logger = { info() {}, warn() {}, error() {} };
let root: string;
let db: AppDatabase;
let config: AppConfig;

beforeEach(() => {
  root = makeTestDirectory("legistar-downloader-");
  config = {
    databasePath: join(root, "test.sqlite"), documentStorePath: join(root, "documents"), runsPath: root,
    legistarClient: "test", apiBase: "https://example.test", portalBase: "https://example.test",
    userAgent: "test", httpTimeoutMs: 1000, downloadConcurrencyNormal: 2,
    downloadConcurrencyBackfill: 1, backfillMeetingDelayMs: 0, maxDownloadRetries: 0,
  };
  db = new AppDatabase(config);
  db.migrate();
  db.upsertMeeting(meeting);
});
afterEach(() => {
  db?.db.close();
  if (root) rmSync(root, { recursive: true, force: true });
});
function entry(overrides: Partial<DocumentManifestEntry> = {}): DocumentManifestEntry {
  return { kind: "agenda", title: "Agenda", sourceUrl: "https://example.test/download", sourceType: "api",
    required: true, eventId: meeting.eventId, eventItemId: null, matterId: null, matterFile: null,
    attachmentId: null, attachmentGuid: null, agendaNumber: null, ...overrides };
}
function http(fetchWithRetry: HttpClient["fetchWithRetry"]): HttpClient {
  return { fetchWithRetry, async getJson<T>(): Promise<T> { throw new Error("unexpected JSON request"); } };
}
function download(item: DocumentManifestEntry, client: HttpClient) {
  return downloadDocument(item, meeting, db, client, config, logger);
}

test("download persists large streamed bytes, digest and headers; rerun skips; missing file redownloads", async () => {
  const chunks = Array.from({ length: 40 }, (_, i) => Buffer.alloc(65536, i));
  const bytes = Buffer.concat(chunks);
  let requests = 0;
  const client = http(async () => {
    requests++;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    }), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename*=UTF-8''Report%20Final.PDF" } });
  });
  const item = entry();
  expect(await download(item, client)).toEqual({ status: "downloaded", bytes: bytes.length });
  const stored = db.getDocumentBySourceUrl(item.sourceUrl)!;
  expect(stored.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(stored.storagePath).toEndWith(".PDF");
  expect(readFileSync(stored.storagePath!)).toEqual(bytes);
  expect(existsSync(`${stored.storagePath}.part`)).toBe(false);
  expect(db.db.query("SELECT http_status, content_type, error FROM documents").get()).toEqual({ http_status: 200, content_type: "application/pdf", error: null });
  expect(await download(item, client)).toEqual({ status: "skipped", bytes: bytes.length });
  expect(requests).toBe(1);
  unlinkSync(stored.storagePath!);
  expect(await download(item, http(async () => new Response("recovered", { headers: { "content-type": "application/pdf" } })))).toEqual({ status: "downloaded", bytes: 9 });
  expect(readFileSync(db.getDocumentBySourceUrl(item.sourceUrl)!.storagePath!, "utf8")).toBe("recovered");
});

test("null bodies fail without leaving a partial file and can be retried", async () => {
  const item = entry();
  const headers = new Headers({ "content-type": "application/pdf" });
  const path = buildStoragePath(config.documentStorePath, meeting, item, "application/pdf", headers);
  expect(await download(item, http(async () => new Response(null, { headers })))).toEqual({ status: "failed", error: "response had no body" });
  expect(existsSync(`${path}.part`)).toBe(false);
  expect(db.getDocumentBySourceUrl(item.sourceUrl)?.downloadStatus).toBe("failed");
  expect(await download(item, http(async () => new Response("retry", { headers })))).toEqual({ status: "downloaded", bytes: 5 });
});

test("network rejection records Error and non-Error reasons", async () => {
  for (const reason of [new Error("offline"), "disconnected"]) {
    const item = entry({ sourceUrl: `https://example.test/${String(reason)}` });
    expect(await download(item, http(async () => { throw reason; }))).toEqual({ status: "failed", error: reason instanceof Error ? reason.message : reason });
    expect(db.getDocumentBySourceUrl(item.sourceUrl)?.downloadStatus).toBe("failed");
  }
});

test("HTML download rejection cancels its body while ViewReport HTML is allowed", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const headers = { "content-type": "text/html; charset=utf-8" };
  expect(await download(entry(), http(async () => new Response(body, { headers })))).toEqual({ status: "failed", error: "download returned an HTML page instead of a file" });
  expect(cancelled).toBe(true);
  const item = entry({ sourceUrl: "https://example.test/ViewReport.ashx?id=1" });
  expect(await download(item, http(async () => new Response("<html>report</html>", { headers })))).toEqual({ status: "downloaded", bytes: 19 });
  expect(readFileSync(db.getDocumentBySourceUrl(item.sourceUrl)!.storagePath!, "utf8")).toBe("<html>report</html>");
});

test("manifest combines downloaded, skipped and failed outcomes with bounded concurrent requests", async () => {
  const skipped = entry({ sourceUrl: "https://example.test/existing", title: "Existing" });
  await download(skipped, http(async () => new Response("cached")));
  const items = [skipped, ...Array.from({ length: 5 }, (_, i) => entry({ sourceUrl: `https://example.test/${i}`, title: `Document ${i}` }))];
  const requested: string[] = [];
  let active = 0;
  let peak = 0;
  const client = http(async (url) => {
    requested.push(url);
    active++;
    peak = Math.max(active, peak);
    await Bun.sleep(10);
    active--;
    if (url.endsWith("/2")) throw new Error("unavailable");
    return new Response("data");
  });
  expect(await downloadManifest(items, meeting, db, client, config, logger, 2)).toEqual({
    downloaded: 4, skipped: 1, failed: [{ url: "https://example.test/2", title: "Document 2", error: "unavailable" }], bytes: 22,
  });
  expect(peak).toBe(2);
  expect(requested.sort()).toEqual(items.slice(1).map((item) => item.sourceUrl).sort());
  expect(db.db.query("SELECT download_status, COUNT(*) AS count FROM documents GROUP BY download_status ORDER BY download_status").all()).toEqual([
    { download_status: "downloaded", count: 5 }, { download_status: "failed", count: 1 },
  ]);
});

test("empty manifests and nonpositive concurrency retain their existing behavior", async () => {
  const client = http(async () => new Response("ok"));
  expect(await downloadManifest([], meeting, db, client, config, logger, 4)).toEqual({ downloaded: 0, skipped: 0, failed: [], bytes: 0 });
  expect(await downloadManifest([entry()], meeting, db, client, config, logger, 0)).toEqual({ downloaded: 1, skipped: 0, failed: [], bytes: 2 });
});

test("HTML media types are rejected case-insensitively", async () => {
  expect(await download(entry(), http(async () => new Response("not a file", { headers: { "content-type": "TEXT/HTML; charset=utf-8" } })))).toEqual({ status: "failed", error: "download returned an HTML page instead of a file" });
});

test("directory creation failure cancels an otherwise valid response body", async () => {
  writeFileSync(config.documentStorePath, "not a directory");
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const result = await download(entry(), http(async () => new Response(body)));
  expect(result.status).toBe("failed");
  expect(cancelled).toBe(true);
  expect(db.getDocumentBySourceUrl(entry().sourceUrl)?.downloadStatus).toBe("failed");
});

test("rename failure removes completed part file and does not mark downloaded", async () => {
  const item = entry();
  const path = buildStoragePath(config.documentStorePath, meeting, item, "application/pdf", new Headers());
  mkdirSync(path, { recursive: true });
  const result = await download(item, http(async () => new Response("data", { headers: { "content-type": "application/pdf" } })));
  expect(result.status).toBe("failed");
  expect(existsSync(`${path}.part`)).toBe(false);
  expect(db.getDocumentBySourceUrl(item.sourceUrl)?.downloadStatus).toBe("failed");
});

test("file-open failure cancels the source and records the filesystem error", async () => {
  const item = entry();
  const path = buildStoragePath(config.documentStorePath, meeting, item, null, new Headers());
  mkdirSync(`${path}.part`, { recursive: true });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(65536)); },
    cancel() { cancelled = true; },
  });
  const result = await download(item, http(async () => new Response(body)));
  expect(result.status).toBe("failed");
  if (result.status === "failed") expect(result.error).toContain("EISDIR");
  expect(cancelled).toBe(true);
  expect(existsSync(path)).toBe(false);
  expect(db.getDocumentBySourceUrl(item.sourceUrl)?.downloadStatus).toBe("failed");
});

test("body cancellation failures never replace the original HTTP error", async () => {
  const body = new ReadableStream({ cancel() { throw new Error("cancel failed"); } });
  expect(await download(entry(), http(async () => new Response(body, { status: 404 })))).toEqual({ status: "failed", error: "download failed with HTTP 404" });
});

test("HTTP rejection cancels the unused body and records its status", async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const item = entry();
  expect(await download(item, http(async () => new Response(body, { status: 503 })))).toEqual({ status: "failed", error: "download failed with HTTP 503" });
  expect(cancelled).toBe(true);
  expect(db.db.query("SELECT http_status FROM documents").get()).toEqual({ http_status: 503 });
});

test("empty downloads are skipped with zero bytes, including legacy null sizes", async () => {
  const item = entry();
  expect(await download(item, http(async () => new Response("")))).toEqual({ status: "downloaded", bytes: 0 });
  const unexpected = http(async () => { throw new Error("cached file must not refetch"); });
  expect(await download(item, unexpected)).toEqual({ status: "skipped", bytes: 0 });
  db.db.query("UPDATE documents SET byte_size = NULL WHERE source_url = ?").run(item.sourceUrl);
  expect(await download(item, unexpected)).toEqual({ status: "skipped", bytes: 0 });
});

test("bodyless HTTP errors retain their status without requiring cancellation", async () => {
  expect(await download(entry(), http(async () => new Response(null, { status: 404 })))).toEqual({ status: "failed", error: "download failed with HTTP 404" });
});

test("failed stream cleans the exact header-selected part file before returning", async () => {
  const item = entry();
  const headers = new Headers({ "content-type": "application/pdf", "content-disposition": 'attachment; filename="packet.docx"' });
  const path = buildStoragePath(config.documentStorePath, meeting, item, "application/pdf", headers);
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(32 * 1024)); },
    async pull(controller) { await Bun.sleep(20); controller.error(new Error("source broke")); },
  });
  expect(await download(item, http(async () => new Response(body, { headers })))).toEqual({ status: "failed", error: "source broke" });
  expect(body.locked).toBe(false);
  expect(existsSync(`${path}.part`)).toBe(false);
  expect(existsSync(path)).toBe(false);
  expect(db.getDocumentBySourceUrl(item.sourceUrl)?.downloadStatus).toBe("failed");
});
