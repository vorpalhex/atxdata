import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config";
import { LegistarApiClient, normalizeItem } from "../legistar/api-client";
import { dedupeManifest } from "../ingest/manifest";
import { downloadManifest } from "../ingest/downloader";
import { AppDatabase } from "../storage/db";
import type { DocumentManifestEntry, NormalizedMeeting, RunSummary } from "../types";
import { createHttpClient, sleep } from "../util/http";
import type { Logger } from "../util/logger";
import { createLogger, makeRunId } from "../util/logger";

export type AppContext = {
  config: AppConfig;
  db: AppDatabase;
};

export type IngestMeetingOptions = {
  eventId?: number;
  date?: string;
  body?: string;
  output?: string;
  concurrency?: number;
};

export async function listMeetings(ctx: AppContext, from: string, to: string, body?: string): Promise<NormalizedMeeting[]> {
  const api = new LegistarApiClient(ctx.config, createHttpClient(ctx.config, quietLogger));
  return await api.listEvents(from, to, body);
}

const quietLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

type JobResources = {
  summary: RunSummary;
  logger: Logger;
  http: ReturnType<typeof createHttpClient>;
  api: LegistarApiClient;
};

/** Owns the common persisted run lifecycle; job bodies own only their work. */
async function runJob(ctx: AppContext, mode: "meeting" | "backfill", output: string, work: (resources: JobResources) => Promise<void>): Promise<RunSummary> {
  const runId = makeRunId(mode);
  const logger = createLogger(runId);
  const summary = baseSummary(runId, mode, output, new Date().toISOString());
  const http = createHttpClient(ctx.config, logger);
  const api = new LegistarApiClient(ctx.config, http);
  ctx.db.createRun(runId, mode);
  let message: string | undefined;
  try {
    await work({ summary, logger, http, api });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    summary.status = "failed";
    summary.failures.push({ url: "", title: "run", error: message });
  }
  finishSummary(ctx, summary, message);
  return summary;
}

export async function ingestMeeting(ctx: AppContext, options: IngestMeetingOptions): Promise<RunSummary> {
  const output = options.output ?? ctx.config.documentStorePath;
  return runJob(ctx, "meeting", output, async (resources) => {
    await ingestResolvedMeeting(ctx, options, resources);
  });
}

async function ingestResolvedMeeting(ctx: AppContext, options: IngestMeetingOptions, { summary, logger, http, api }: JobResources): Promise<void> {
  const meeting = await resolveMeeting(api, options);
  summary.meetingsDiscovered = 1;
  logger.info("meeting.start", { eventId: meeting.eventId, body: meeting.bodyName, date: meeting.meetingDate });
  const rawItems = await api.getRawEventItems(meeting.eventId);
  ctx.db.upsertMeeting(meeting);
  for (const item of rawItems) ctx.db.upsertItem(normalizeItem(item));
  const manifest = dedupeManifest([...api.buildMeetingDocuments(meeting), ...api.buildItemDocuments(rawItems)]);
  summary.documentsDiscovered = manifest.length;
  logger.info("manifest.built", { eventId: meeting.eventId, documents: manifest.length, items: rawItems.length });
  const result = await downloadManifest(
    manifest, meeting, ctx.db, http,
    { ...ctx.config, documentStorePath: summary.outputDirectory }, logger,
    options.concurrency ?? ctx.config.downloadConcurrencyNormal,
  );
  applyDownloadResult(summary, manifest, result);
  logger.info("meeting.end", { eventId: meeting.eventId, status: summary.status });
}

function applyDownloadResult(summary: RunSummary, manifest: DocumentManifestEntry[], result: Awaited<ReturnType<typeof downloadManifest>>): void {
  summary.meetingsProcessed = 1;
  summary.documentsDownloaded = result.downloaded;
  summary.documentsSkipped = result.skipped;
  summary.documentsFailed = result.failed.length;
  summary.totalBytes = result.bytes;
  summary.failures = result.failed;
  const requiredUrls = new Set(manifest.filter((entry) => entry.required).map((entry) => entry.sourceUrl));
  summary.status = result.failed.some((failure) => requiredUrls.has(failure.url)) ? "failed" : "succeeded";
}

export async function backfill(ctx: AppContext, from: string, to: string, body?: string): Promise<RunSummary> {
  return runJob(ctx, "backfill", ctx.config.documentStorePath, async ({ summary, logger, api }) => {
    const meetings = await api.listEvents(from, to, body);
    summary.meetingsDiscovered = meetings.length;
    logger.info("backfill.discovered", { from, to, body, meetings: meetings.length });
    for (const meeting of meetings) {
      const child = await ingestMeeting(ctx, {
        eventId: meeting.eventId,
        concurrency: ctx.config.downloadConcurrencyBackfill,
      });
      accumulateChild(summary, child);
      ctx.db.setCheckpoint(summary.runId, "last_meeting", { eventId: meeting.eventId, date: meeting.meetingDate });
      await sleep(ctx.config.backfillMeetingDelayMs);
    }
    summary.status = summary.status === "failed" || summary.documentsFailed > 0 ? "failed" : "succeeded";
  });
}

function accumulateChild(summary: RunSummary, child: RunSummary): void {
  summary.meetingsProcessed += child.meetingsProcessed;
  summary.documentsDiscovered += child.documentsDiscovered;
  summary.documentsDownloaded += child.documentsDownloaded;
  summary.documentsSkipped += child.documentsSkipped;
  summary.documentsFailed += child.documentsFailed;
  summary.totalBytes += child.totalBytes;
  summary.failures.push(...child.failures);
  if (child.status === "failed") summary.status = "failed";
}

export async function retryFailed(_ctx: AppContext): Promise<void> {
  throw new Error("retry-failed is not implemented yet");
}

async function resolveMeeting(api: LegistarApiClient, options: IngestMeetingOptions): Promise<NormalizedMeeting> {
  if (options.eventId) return await api.getEvent(options.eventId);
  if (options.date) {
    const body = options.body ?? "City Council";
    const meetings = await api.listEvents(options.date, options.date, body);
    if (meetings.length === 0) throw new Error(`No meeting found for ${body} on ${options.date}`);
    if (meetings.length > 1) throw new Error(`Multiple meetings found for ${body} on ${options.date}; use --event-id`);
    return meetings[0]!;
  }
  throw new Error("Provide --event-id or --date");
}

function baseSummary(runId: string, mode: "meeting" | "backfill", outputDirectory: string, startedAt: string): RunSummary {
  return {
    runId,
    mode,
    status: "running",
    meetingsDiscovered: 0,
    meetingsProcessed: 0,
    documentsDiscovered: 0,
    documentsDownloaded: 0,
    documentsSkipped: 0,
    documentsFailed: 0,
    totalBytes: 0,
    outputDirectory,
    startedAt,
    failures: [],
  };
}

function finishSummary(ctx: AppContext, summary: RunSummary, error?: string) {
  summary.finishedAt = new Date().toISOString();
  mkdirSync(ctx.config.runsPath, { recursive: true });
  writeFileSync(join(ctx.config.runsPath, `${summary.runId}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  const status = summary.status === "running" ? "failed" : summary.status;
  ctx.db.finishRun(summary.runId, status, error);
}
