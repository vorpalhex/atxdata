import type { PoliteHttpClient } from "./http";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { archiveLock, statFile, savePdf, promote } from "./archive";
import { join } from "node:path";

import { sanitizeSegment } from "../../legistar-consume/src/util/strings";

import { CivicDatabase, type StoredDocument } from "./storage/db";
import type { CivicEvent, PublishedFile } from "./types";
export type { CivicEvent, PublishedFile } from "./types";
async function checksum(path: string): Promise<{ byteSize: number; sha256: string }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) { byteSize += chunk.length; hash.update(chunk); }
  return { byteSize, sha256: hash.digest("hex") };
}
const rejectSymlink = statFile;
export type DownloadOptions = { offline?: boolean; fileTypes?: number[]; maxDocuments?: number; maxBytes?: number; expectedDate?: string };
type BudgetedOptions = DownloadOptions & { maxDocuments: number; maxBytes: number };
function budget(value: number | undefined, fallback: number): number {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("invalid download budget");
  return result;
}
function downloadOptions(options: DownloadOptions): BudgetedOptions {
  return { ...options, maxDocuments: budget(options.maxDocuments, 100), maxBytes: budget(options.maxBytes, 12 * 1024 * 1024) };
}
async function verifiedFile(path: string, old?: StoredDocument): Promise<{ byteSize: number; sha256: string } | undefined> {
  if (old?.downloadStatus !== "downloaded") return undefined;
  const actual = await checksum(path).catch(() => undefined);
  return actual?.sha256 === old.sha256 && actual?.byteSize === old.byteSize ? actual : undefined;
}

async function recoverFile(path: string, old?: StoredDocument) {
  const present = await statFile(path);
  for (const suffix of [".part", ".pending"]) await statFile(`${path}${suffix}`);
  const actual = await verifiedFile(path, old);
  if (actual) {
    if (await verifiedFile(`${path}.pending`, old)) await unlink(`${path}.pending`);
    return actual;
  }
  if (present) throw new Error("existing file conflicts with checkpoint; preserve and investigate");
  const pending = await verifiedFile(`${path}.pending`, old);
  if (pending) { await promote(path); return pending; }
  if (await statFile(`${path}.pending`) || await statFile(`${path}.part`)) throw new Error("uncheckpointed partial; preserve and investigate");
}
function selectedFiles(event: CivicEvent, options: BudgetedOptions) {
  const files = event.publishedFiles.filter(file => [1, 2, 4, 5].includes(file.fileType) && (!options.fileTypes || options.fileTypes.includes(file.fileType)));
  if (files.length > options.maxDocuments) throw new Error("document count ceiling exceeded");
  return files;
}
function boundPage(target: URL, original: URL) {
  for (const key of ["$filter", "$top", "$count"]) {
    const expected = original.searchParams.get(key)!;
    if (target.searchParams.has(key) && target.searchParams.get(key) !== expected) throw new Error("changed pagination bounds");
    target.searchParams.set(key, expected);
  }
  target.searchParams.sort();
}
function continuationKeys(target: URL): void {
  const seen = new Set<string>();
  for (const key of target.searchParams.keys()) {
    if (seen.has(key) || !["$filter", "$top", "$count", "$skip", "$skiptoken"].includes(key)) throw new Error("unsafe pagination query");
    seen.add(key);
  }
}
function skipOffset(value: string, previous: URL): void {
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= Number(previous.searchParams.get("$skip") ?? 0)) throw new Error("invalid pagination offset");
}
function skipToken(value: string): void {
  if (!value.trim() || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("invalid pagination token");
}
function continuation(target: URL, previous: URL): void {
  continuationKeys(target);
  const skip = target.searchParams.get("$skip"), token = target.searchParams.get("$skiptoken");
  if ((skip === null) === (token === null)) throw new Error("ambiguous pagination continuation");
  if (skip !== null) skipOffset(skip, previous); else skipToken(token ?? "");
}
function continuationPath(link: string): void {
  const path = link.split(/[?#]/)[0] ?? "";
  if (link.includes("#") || /[\s\\%@]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) throw new Error("unsafe pagination path");
}
function pageCount(page: Record<string, unknown>, previous?: number): number | undefined {
  const value = page["@odata.count"];
  if (value === undefined) return previous;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || (previous !== undefined && value !== previous)) throw new Error("invalid event count");
  return value;
}
function appendEvents(events: CivicEvent[], page: Record<string, unknown>, from: string, to: string) {
  if (!Array.isArray(page.value)) throw new Error("invalid event page");
  if (page.value.length > 25) throw new Error("event page ceiling exceeded");
  for (const event of page.value.map(normalizeEvent)) {
    if (event.eventDate.slice(0, 10) < from || event.eventDate.slice(0, 10) > to || events.some(old => old.id === event.id)) throw new Error("duplicate or out-of-range event");
    events.push(event);
  }
}
function nextPage(page: Record<string, unknown>, target: URL): string | undefined {
  const link = page["@odata.nextLink"];
  if (link !== undefined && typeof link !== "string") throw new Error("invalid pagination link");
  if (!link) return undefined;
  continuationPath(link);
  const next = new URL(link, target);
  continuation(next, target);
  return next.href;
}

export const DEFAULT_API_BASE = "https://traviscotx.api.civicclerk.com/v1/";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid metadata object");
  return value as Record<string, unknown>;
}
function positiveId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("invalid positive ID");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid metadata string");
  return value;
}
export function calendarDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("invalid calendar date");
  return value;
}
function normalizeEvent(value: unknown): CivicEvent {
  const raw = object(value);
  const date = text(raw.eventDate);
  calendarDate(date.slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error("invalid event date");
  if (!Array.isArray(raw.publishedFiles)) throw new Error("invalid publishedFiles");
  return { id: positiveId(raw.id), eventName: text(raw.eventName), eventDate: new Date(date).toISOString(), publishedFiles: raw.publishedFiles.map(value => {
    const file = object(value);
    return { fileId: positiveId(file.fileId), fileType: positiveId(file.fileType), type: text(file.type), name: text(file.name) };
  }) };
}

export class CivicClerkClient {
  private readonly base: URL;
  constructor(private readonly http: Pick<PoliteHttpClient, "request" | "getJson">, base = DEFAULT_API_BASE) {
    this.base = new URL(base.endsWith("/") ? base : `${base}/`);
  }

  async downloadEvent(id: number, output: string, options: DownloadOptions = {}): Promise<{ downloaded: number; skipped: number }> {
    positiveId(id);
    const bounded = downloadOptions(options);
    const release = await archiveLock(output);
    try { return await this.lockedDownload(id, output, bounded); } finally { await release(); }
  }
  private async lockedDownload(id: number, output: string, options: BudgetedOptions) {
    const folder = join(output, `event-${id}`);
    await rejectSymlink(folder);
    await mkdir(folder, { recursive: true });
    const databasePath = join(output, "civicclerk.sqlite");
    for (const suffix of ["", "-wal", "-shm", "-journal"]) await rejectSymlink(`${databasePath}${suffix}`);
    const store = new CivicDatabase(databasePath, this.base.href);
    try {
      const event = options.offline ? normalizeEvent(store.cachedEvent(id)) : await this.getEvent(id);
      if (event.id !== id) throw new Error("event ID mismatch");
      if (options.expectedDate && event.eventDate.slice(0, 10) !== calendarDate(options.expectedDate)) throw new Error("event date mismatch");
      if (!options.offline) store.snapshot(event);
      return await this.ingest(event, folder, store, options);
    } finally { store.close(); }
  }

  private async ingest(event: CivicEvent, folder: string, store: CivicDatabase, options: BudgetedOptions): Promise<{ downloaded: number; skipped: number }> {
    store.upsertMeeting(event);
    const run = store.startRun(event.id);
    let downloaded = 0, skipped = 0;
    try {
      const files = selectedFiles(event, options);
      let remaining = options.maxBytes;
      for (const file of files) {
        const result = await this.ingestFile(event.id, file, folder, store, remaining, !!options.offline);
        remaining -= result.byteSize;
        if (remaining < 0) throw new Error("PDF byte ceiling exceeded");
        if (result.skipped) skipped++; else downloaded++;
      }
      store.finishRun(run, "succeeded");
      return { downloaded, skipped };
    } catch (error) {
      store.finishRun(run, "failed", String(error));
      throw error;
    }
  }

  private async ingestFile(id: number, file: PublishedFile, folder: string, store: CivicDatabase, maxBytes: number, offline: boolean) {
    const filename = `type-${file.fileType}_file-${file.fileId}_${sanitizeSegment(file.name)}.pdf`;
    const path = join(folder, filename);
    const sourceUrl = new URL(`Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=false)`, this.base).href;
    store.discover(id, { ...file, filename, sourceUrl });
    const old = store.document(id, file);
    if (maxBytes === 0 || (old?.byteSize ?? 0) > maxBytes) throw new Error("PDF byte ceiling exceeded");
    try {
      const actual = await recoverFile(path, old);
      if (actual) return { ...actual, skipped: true };
      if (offline) throw new Error("offline checkpoint missing or invalid");
      const written = await this.http.request(sourceUrl, response => savePdf(response, path, maxBytes));
      store.downloaded(id, file, written); // Durable checksum before no-clobber promotion enables crash recovery.
      await promote(path);
      return { ...written, skipped: false };
    } catch (error) {
      store.failed(id, file, String(error));
      throw error;
    }
  }

  async getEvent(id: number): Promise<CivicEvent> {
    positiveId(id);
    const event = normalizeEvent(await this.http.getJson(new URL(`Events/${id}`, this.base).href));
    if (event.id !== id) throw new Error("event ID mismatch");
    return event;
  }

  private validatePage(target: URL, visited: Set<string>): void {
    if (target.origin !== this.base.origin || target.pathname !== new URL("Events", this.base).pathname || target.username || target.password || target.hash || visited.has(target.href)) throw new Error("unsafe or cyclic pagination");
  }

  async listEvents(from: string, to: string): Promise<CivicEvent[]> {
    calendarDate(from);
    calendarDate(to);
    if (from > to) throw new Error("reversed date range");
    const end = new Date(`${to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const url = new URL("Events", this.base);
    url.searchParams.set("$filter", `eventDate ge ${from}T00:00:00Z and eventDate lt ${end.toISOString().replace(".000", "")} and isPublished eq 'Published'`);
    url.searchParams.set("$top", "25");
    url.searchParams.set("$count", "true");
    const events: CivicEvent[] = [];
    let count: number | undefined;
    let next: string | undefined = url.href;
    const visited = new Set<string>();
    while (next) {
      const target: URL = new URL(next, this.base);
      boundPage(target, url);
      if (visited.size >= 20) throw new Error("pagination page ceiling exceeded");
      this.validatePage(target, visited);
      visited.add(target.href);
      const page = object(await this.http.getJson(target.href));
      count = pageCount(page, count);
      appendEvents(events, page, from, to);
      next = nextPage(page, target);
    }
    if (count !== undefined && events.length !== count) throw new Error("event count mismatch");
    return events;
  }
}
