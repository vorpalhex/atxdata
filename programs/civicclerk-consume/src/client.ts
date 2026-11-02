import type { PoliteHttpClient } from "./http";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { saveResponse } from "../../legistar-consume/src/ingest/downloader";
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
async function rejectSymlink(path: string): Promise<void> {
  const stat = await lstat(path).catch(error => { if (error.code !== "ENOENT") throw error; return undefined; });
  if (stat?.isSymbolicLink()) throw new Error("unsafe symlink in output");
}
async function verifiedFile(path: string, old?: StoredDocument): Promise<{ byteSize: number; sha256: string } | undefined> {
  if (old?.downloadStatus !== "downloaded") return undefined;
  const actual = await checksum(path).catch(() => undefined);
  return actual?.sha256 === old.sha256 && actual?.byteSize === old.byteSize ? actual : undefined;
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

  async downloadEvent(id: number, output: string): Promise<{ downloaded: number; skipped: number }> {
    const event = await this.getEvent(id);
    const folder = join(output, `event-${id}`);
    await rejectSymlink(folder);
    await mkdir(folder, { recursive: true });
    const databasePath = join(output, "civicclerk.sqlite");
    for (const suffix of ["", "-wal", "-shm", "-journal"]) await rejectSymlink(`${databasePath}${suffix}`);
    const store = new CivicDatabase(databasePath, this.base.href);
    try { return await this.ingest(event, folder, store); }
    finally { store.close(); }
  }

  private async ingest(event: CivicEvent, folder: string, store: CivicDatabase): Promise<{ downloaded: number; skipped: number }> {
    store.upsertMeeting(event);
    const run = store.startRun(event.id);
    let downloaded = 0, skipped = 0;
    try {
      for (const file of event.publishedFiles.filter(file => [1, 2, 4, 5].includes(file.fileType))) {
        if (await this.ingestFile(event.id, file, folder, store)) skipped++; else downloaded++;
      }
      store.finishRun(run, "succeeded");
      return { downloaded, skipped };
    } catch (error) {
      store.finishRun(run, "failed", String(error));
      throw error;
    }
  }

  private async ingestFile(id: number, file: PublishedFile, folder: string, store: CivicDatabase): Promise<boolean> {
    const filename = `type-${file.fileType}_file-${file.fileId}_${sanitizeSegment(file.name)}.pdf`;
    const path = join(folder, filename);
    const sourceUrl = new URL(`Meetings/GetMeetingFileStream(fileId=${file.fileId},plainText=false)`, this.base).href;
    store.discover(id, { ...file, filename, sourceUrl });
    try {
      await rejectSymlink(path);
      await rejectSymlink(`${path}.part`);
      const actual = await verifiedFile(path, store.document(id, file));
      const written = actual ?? await this.downloadPdf(sourceUrl, path);
      store.downloaded(id, file, written);
      return actual !== undefined;
    } catch (error) {
      store.failed(id, file, String(error));
      throw error;
    }
  }

  private downloadPdf(sourceUrl: string, path: string): Promise<{ byteSize: number; sha256: string }> {
    return this.http.request(sourceUrl, async response => {
      if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/pdf") {
        await response.body?.cancel();
        throw new Error("expected a successful PDF response");
      }
      return saveResponse(response, path, `${path}.part`);
    });
  }

  async getEvent(id: number): Promise<CivicEvent> {
    positiveId(id);
    const event = normalizeEvent(await this.http.getJson(new URL(`Events/${id}`, this.base).href));
    if (event.id !== id) throw new Error("event ID mismatch");
    return event;
  }

  private validatePage(target: URL, visited: Set<string>): void {
    if (target.origin !== this.base.origin || !target.pathname.startsWith(this.base.pathname) || target.username || target.password || target.hash || visited.has(target.href)) throw new Error("unsafe or cyclic pagination");
  }

  async listEvents(from: string, to: string): Promise<CivicEvent[]> {
    calendarDate(from);
    calendarDate(to);
    if (from > to) throw new Error("reversed date range");
    const end = new Date(`${to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const url = new URL("Events", this.base);
    url.searchParams.set("$filter", `eventDate ge ${from}T00:00:00Z and eventDate lt ${end.toISOString().replace(".000", "")} and isPublished eq 'Published'`);
    const events: CivicEvent[] = [];
    let next: string | undefined = url.href;
    const visited = new Set<string>();
    while (next) {
      const target: URL = new URL(next, this.base);
      this.validatePage(target, visited);
      visited.add(target.href);
      const page = object(await this.http.getJson(next));
      if (!Array.isArray(page.value)) throw new Error("invalid event page");
      events.push(...page.value.map(normalizeEvent));
      const link = page["@odata.nextLink"];
      if (link !== undefined && typeof link !== "string") throw new Error("invalid pagination link");
      next = link ? new URL(link, target).href : undefined;
    }
    return events;
  }
}
