import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, dirname, extname, join } from "node:path";
import type { AppConfig } from "../config";
import type { AppDatabase, StoredDocument } from "../storage/db";
import type { DocumentManifestEntry, NormalizedMeeting } from "../types";
import type { HttpClient } from "../util/http";
import type { Logger } from "../util/logger";
import { extensionFromContentType, sanitizeSegment } from "../util/strings";

export type DownloadOutcome =
  | { status: "downloaded"; bytes: number }
  | { status: "skipped"; bytes: number }
  | { status: "failed"; error: string };

export async function downloadDocument(
  entry: DocumentManifestEntry,
  meeting: NormalizedMeeting,
  db: AppDatabase,
  http: HttpClient,
  config: AppConfig,
  logger: Logger,
): Promise<DownloadOutcome> {
  const id = db.upsertDocument(entry);
  const existing = db.getDocumentBySourceUrl(entry.sourceUrl);
  if (hasDownloadedFile(existing)) {
    logger.info("document.skipped", { id, url: entry.sourceUrl, path: existing.storagePath });
    return { status: "skipped", bytes: existing.byteSize ?? 0 };
  }

  try {
    const response = await fetchDocumentResponse(http, entry.sourceUrl);
    const contentType = response.headers.get("content-type");

    const storagePath = buildStoragePath(config.documentStorePath, meeting, entry, contentType, response.headers);
    const partPath = `${storagePath}.part`;
    const written = await saveResponse(response, storagePath, partPath);

    db.markDownloaded(id, {
      httpStatus: response.status,
      contentType,
      byteSize: written.byteSize,
      sha256: written.sha256,
      storagePath,
    });

    logger.info("document.downloaded", {
      id,
      kind: entry.kind,
      title: entry.title,
      url: entry.sourceUrl,
      path: storagePath,
      bytes: written.byteSize,
      sha256: written.sha256,
    });
    return { status: "downloaded", bytes: written.byteSize };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const httpStatus = error instanceof DownloadError ? error.status : undefined;
    db.markFailed(id, message, httpStatus);
    logger.error("document.failed", { id, url: entry.sourceUrl, title: entry.title, error: message });
    return { status: "failed", error: message };
  }
}

function hasDownloadedFile(document: StoredDocument | null): document is StoredDocument & { storagePath: string } {
  return Boolean(document?.downloadStatus === "downloaded" && document.storagePath && existsSync(document.storagePath));
}

async function fetchDocumentResponse(http: HttpClient, url: string): Promise<Response> {
  const response = await http.fetchWithRetry(url);
  try {
    if (!response.ok) throw new DownloadError(`download failed with HTTP ${response.status}`, response.status);
    if (looksLikeHtmlError(response.headers.get("content-type"), url)) {
      throw new DownloadError("download returned an HTML page instead of a file", response.status);
    }
    return response;
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    throw error;
  }
}

export async function downloadManifest(
  entries: DocumentManifestEntry[],
  meeting: NormalizedMeeting,
  db: AppDatabase,
  http: HttpClient,
  config: AppConfig,
  logger: Logger,
  concurrency: number,
): Promise<{ downloaded: number; skipped: number; failed: Array<{ url: string; title: string; error: string }>; bytes: number }> {
  let index = 0;
  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;
  const failed: Array<{ url: string; title: string; error: string }> = [];

  async function worker() {
    while (index < entries.length) {
      const entry = entries[index++]!;
      const outcome = await downloadDocument(entry, meeting, db, http, config, logger);
      if (outcome.status === "downloaded") {
        downloaded += 1;
        bytes += outcome.bytes;
      } else if (outcome.status === "skipped") {
        skipped += 1;
        bytes += outcome.bytes;
      } else {
        failed.push({ url: entry.sourceUrl, title: entry.title, error: outcome.error });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return { downloaded, skipped, failed, bytes };
}

export function buildStoragePath(
  root: string,
  meeting: NormalizedMeeting,
  entry: DocumentManifestEntry,
  contentType: string | null,
  headers: Headers,
): string {
  const extension = documentExtension(entry.sourceUrl, contentType, headers);
  const { folders, filename } = entry.kind === "matter_attachment"
    ? attachmentLocation(entry)
    : meetingDocumentLocation(meeting, entry);
  return join(root, `${sanitizeSegment(meeting.bodyName)}-meeting`, sanitizeSegment(meeting.meetingDate), ...folders, `${filename}${extension}`);
}

function documentExtension(sourceUrl: string, contentType: string | null, headers: Headers): string {
  const filename = filenameFromContentDisposition(headers.get("content-disposition")) ?? filenameFromUrl(sourceUrl) ?? "";
  const extension = extname(filename);
  if (/^\.[a-z0-9]+$/i.test(extension)) return extension;
  return extensionFromContentType(contentType) || ".bin";
}

type DocumentLocation = { folders: string[]; filename: string };

function meetingDocumentLocation(meeting: NormalizedMeeting, entry: DocumentManifestEntry): DocumentLocation {
  return {
    folders: ["meeting-documents", sanitizeSegment(entry.kind.replace(/_/g, "-"))],
    filename: `${sanitizeSegment(entry.title)}_event-${meeting.eventId}`,
  };
}

function attachmentLocation(entry: DocumentManifestEntry): DocumentLocation {
  const agendaItem = sanitizeSegment(entry.agendaNumber ?? String(entry.eventItemId ?? "unknown"), "unknown").replace(/\.+$/g, "") || "unknown";
  const matterFolder = entry.matterFile
    ? `matter-file-${sanitizeSegment(entry.matterFile)}`
    : `matter-id-${sanitizeSegment(String(entry.matterId ?? "unknown"))}`;
  return {
    folders: [`agenda_item_${agendaItem}`, matterFolder, "attachment-documents"],
    filename: `attachment-${entry.attachmentId ?? "unknown"}_${sanitizeSegment(entry.title)}`,
  };
}

function filenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const name = basename(parsed.pathname);
    return name || null;
  } catch {
    return null;
  }
}

function filenameFromContentDisposition(header: string | null): string | null {
  const utf8 = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(header ?? "");
  const decoded = decodeFilename(utf8?.[1]);
  if (decoded) return decoded;
  const basic = /(?:^|;)\s*filename="?([^";]+)"?/i.exec(header ?? "");
  return basic?.[1]?.trim() || null;
}

function decodeFilename(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value.trim());
  } catch {
    return null;
  }
}

async function saveResponse(response: Response, storagePath: string, partPath: string) {
  try {
    mkdirSync(dirname(storagePath), { recursive: true });
    const written = await writeResponseBody(response, partPath);
    renameSync(partPath, storagePath);
    return written;
  } finally {
    await response.body?.cancel().catch(() => {});
    removePartialFile(partPath);
  }
}

function removePartialFile(partPath: string): void {
  try {
    rmSync(partPath, { force: true });
  } catch {
    // Cleanup is best-effort: retain the original transfer or filesystem error.
  }
}

async function writeResponseBody(response: Response, partPath: string): Promise<{ byteSize: number; sha256: string }> {
  if (!response.body) throw new Error("response had no body");
  const hash = createHash("sha256");
  let byteSize = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.byteLength;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(responseStream(response.body), meter, createWriteStream(partPath));
  return { byteSize, sha256: hash.digest("hex") };
}

// A Node Readable's destroy must interrupt a pending Web reader.read().
// Readable.from(asyncIterable) waits for that read before closing the iterator.
function responseStream(body: ReadableStream<Uint8Array>): Readable {
  const reader = body.getReader();
  return new Readable({
    read() {
      void reader.read().then(
        ({ done, value }) => { this.push(done ? null : value); },
        (error: Error) => { this.destroy(error); },
      );
    },
    destroy(error, callback) {
      void reader.cancel(error).catch(() => {}).then(() => {
        reader.releaseLock();
        callback(error);
      });
    },
  });
}

function looksLikeHtmlError(contentType: string | null, sourceUrl: string): boolean {
  return extensionFromContentType(contentType) === ".html" && !sourceUrl.includes("ViewReport.ashx");
}

class DownloadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
