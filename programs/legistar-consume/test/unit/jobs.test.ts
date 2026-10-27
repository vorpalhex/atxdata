import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeTestDirectory } from "../support/temp-dir";
import type { AppConfig } from "../../src/config";
import { AppDatabase } from "../../src/storage/db";
import { backfill, ingestMeeting, listMeetings, retryFailed } from "../../src/jobs/ingest";

async function fixture(run: (ctx: { config: AppConfig; db: AppDatabase }, origin: string) => Promise<void>, route: (path: string, origin: string) => Response = () => Response.json([])) {
  const root = makeTestDirectory("legistar-jobs-");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => route(new URL(request.url).pathname, new URL(request.url).origin) });
  const origin = `http://127.0.0.1:${server.port}`;
  const config: AppConfig = { legistarClient: "test", apiBase: origin, portalBase: origin,
    databasePath: join(root, "db.sqlite"), documentStorePath: join(root, "documents"), runsPath: join(root, "runs"),
    userAgent: "test", httpTimeoutMs: 1000, maxDownloadRetries: 0, downloadConcurrencyNormal: 1,
    downloadConcurrencyBackfill: 1, backfillMeetingDelayMs: 0 };
  const db = new AppDatabase(config);
  db.migrate();
  try { await run({ config, db }, origin); }
  finally { db.db.close(); server.stop(true); rmSync(root, { recursive: true, force: true }); }
}

test("date lookup, listing and metadata persistence use the same normalized fields", async () => {
  await fixture(async (ctx) => {
    expect(await listMeetings(ctx, "2026-01-01", "2026-01-01", " city council ")).toHaveLength(1);
    const result = await ingestMeeting(ctx, { date: "2026-01-01" });
    expect(result.status).toBe("succeeded");
    expect(result.meetingsDiscovered).toBe(1);
    expect(result.meetingsProcessed).toBe(1);
    expect(ctx.db.db.query("SELECT * FROM meeting_items").get()).toEqual({ event_item_id: 2, event_item_guid: "", event_id: 1, agenda_sequence: 0, minutes_sequence: 0, agenda_number: "", title: "", matter_id: 0, matter_guid: "", matter_file: "", matter_name: "", matter_type: "", matter_status: "" });
  }, (path) => {
    const event = { EventId: 1, EventBodyName: " City Council ", EventDate: "2026-01-01" };
    if (path.endsWith("EventItems")) return Response.json([{ EventItemId: 2, EventItemEventId: 1, EventItemGuid: "", EventItemAgendaSequence: 0, EventItemMinutesSequence: 0, EventItemAgendaNumber: "", EventItemTitle: "", EventItemMatterId: 0, EventItemMatterGuid: "", EventItemMatterFile: "", EventItemMatterName: "", EventItemMatterType: "", EventItemMatterStatus: "" }]);
    return Response.json(path === "/test/Events" ? [event] : event);
  });
});

test("missing, absent and ambiguous meeting selectors persist failed run summaries", async () => {
  for (const count of [0, 2]) {
    await fixture(async (ctx) => {
      const result = await ingestMeeting(ctx, { date: "2026-01-01" });
      expect(result.status).toBe("failed");
      expect(result.failures[0]?.error).toContain(count === 0 ? "No meeting found" : "Multiple meetings found");
      expect(saved(ctx, result.runId)).toEqual(result);
    }, () => Response.json(Array.from({ length: count }, (_, i) => ({ EventId: i + 1, EventBodyName: "City Council" }))));
  }
  await fixture(async (ctx) => {
    const result = await ingestMeeting(ctx, {});
    expect(result.meetingsDiscovered).toBe(0);
    expect(result.failures[0]?.error).toBe("Provide --event-id or --date");
    await expect(retryFailed(ctx)).rejects.toThrow("retry-failed is not implemented yet");
  });
});

test("successful backfill accumulates children and persists final checkpoint", async () => {
  await fixture(async (ctx) => {
    const result = await backfill(ctx, "2026-01-01", "2026-01-02");
    expect(result.status).toBe("succeeded");
    expect(result.meetingsDiscovered).toBe(2);
    expect(result.meetingsProcessed).toBe(2);
    expect(ctx.db.db.query("SELECT checkpoint_value_json FROM job_checkpoints WHERE run_id = ?").get(result.runId)).toEqual({ checkpoint_value_json: JSON.stringify({ eventId: 2, date: "2026-01-02" }) });
  }, (path) => {
    if (path.endsWith("EventItems")) return Response.json([]);
    if (path === "/test/Events") return Response.json([{ EventId: 1 }, { EventId: 2, EventDate: "2026-01-02" }]);
    return Response.json({ EventId: Number(path.split("/").at(-1)) });
  });
});

test("backfill discovery failure is persisted rather than thrown", async () => {
  await fixture(async (ctx) => {
    const result = await backfill(ctx, "2026-01-01", "2026-01-02");
    expect(result.status).toBe("failed");
    expect(result.failures[0]?.error).toContain("404");
    expect(saved(ctx, result.runId)).toEqual(result);
  }, () => new Response("missing", { status: 404 }));
});

test("required download failures fail a meeting while optional failures remain visible without failing it", async () => {
  for (const required of [true, false]) {
    await fixture(async (ctx) => {
      const result = await ingestMeeting(ctx, { eventId: 1 });
      expect(result.status).toBe(required ? "failed" : "succeeded");
      expect(result.documentsDiscovered).toBe(1);
      expect(result.documentsFailed).toBe(1);
      expect(result.failures[0]?.error).toContain("404");
    }, (path, origin) => {
      if (path.endsWith("EventItems")) return Response.json([]);
      if (path === "/test/Events/1") return Response.json({ EventId: 1, [required ? "EventAgendaFile" : "EventMinutesFile"]: `${origin}/missing.pdf` });
      return new Response("missing", { status: 404 });
    });
  }
});

test("meeting downloads to override path and a repeated ingestion skips existing bytes", async () => {
  await fixture(async (ctx) => {
    const output = join(ctx.config.documentStorePath, "override");
    const first = await ingestMeeting(ctx, { eventId: 1, output, concurrency: 1 });
    expect(first.documentsDownloaded).toBe(1);
    expect(first.documentsSkipped).toBe(0);
    expect(first.totalBytes).toBe(8);
    const document = ctx.db.db.query("SELECT storage_path FROM documents").get() as { storage_path: string };
    expect(document.storage_path.startsWith(output)).toBe(true);
    expect(readFileSync(document.storage_path, "utf8")).toBe("%PDF-1.0");
    const second = await ingestMeeting(ctx, { eventId: 1, output });
    expect(second.status).toBe("succeeded");
    expect(second.documentsDownloaded).toBe(0);
    expect(second.documentsSkipped).toBe(1);
    expect(second.totalBytes).toBe(8);
  }, (path, origin) => {
    if (path.endsWith("EventItems")) return Response.json([]);
    if (path === "/test/Events/1") return Response.json({ EventId: 1, EventAgendaFile: `${origin}/agenda.pdf` });
    return new Response("%PDF-1.0", { headers: { "Content-Type": "application/pdf" } });
  });
});

test("backfill totals include downloads, skips and optional failures across repeated runs", async () => {
  await fixture(async (ctx) => {
    const first = await backfill(ctx, "2026-01-01", "2026-01-02");
    expect(first.status).toBe("failed");
    expect(first.meetingsProcessed).toBe(1);
    expect(first.documentsDiscovered).toBe(2);
    expect(first.documentsDownloaded).toBe(1);
    expect(first.documentsSkipped).toBe(0);
    expect(first.documentsFailed).toBe(1);
    expect(first.totalBytes).toBe(8);
    expect(first.failures).toHaveLength(1);
    const second = await backfill(ctx, "2026-01-01", "2026-01-02");
    expect(second.status).toBe("failed");
    expect(second.documentsDownloaded).toBe(0);
    expect(second.documentsSkipped).toBe(1);
    expect(second.documentsFailed).toBe(1);
    expect(second.totalBytes).toBe(8);
  }, (path, origin) => {
    if (path === "/test/Events") return Response.json([{ EventId: 1 }]);
    if (path.endsWith("EventItems")) return Response.json([]);
    if (path === "/test/Events/1") return Response.json({ EventId: 1, EventAgendaFile: `${origin}/agenda.pdf`, EventMinutesFile: `${origin}/missing.pdf` });
    if (path === "/agenda.pdf") return new Response("%PDF-1.0", { headers: { "Content-Type": "application/pdf" } });
    return new Response("missing", { status: 404 });
  });
});

test("empty backfill succeeds without fabricating processed meetings", async () => {
  await fixture(async (ctx) => {
    const result = await backfill(ctx, "2026-01-01", "2026-01-02");
    expect(result.status).toBe("succeeded");
    expect(result.meetingsDiscovered).toBe(0);
    expect(result.meetingsProcessed).toBe(0);
    expect(result.failures).toEqual([]);
  });
});

function saved(ctx: { config: AppConfig; db: AppDatabase }, runId: string) {
  const result = JSON.parse(readFileSync(join(ctx.config.runsPath, `${runId}.json`), "utf8"));
  expect(ctx.db.db.query("SELECT status FROM ingest_runs WHERE id = ?").get(runId)).toEqual({ status: result.status });
  return result;
}

test("backfill fails when child metadata fetch fails with zero failed downloads", async () => {
  await fixture(async (ctx) => {
    const result = await backfill(ctx, "2026-01-01", "2026-01-02");
    expect(result.documentsFailed).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.status).toBe("failed");
    expect(saved(ctx, result.runId)).toEqual(result);
    expect(ctx.db.db.query("SELECT status FROM ingest_runs WHERE id = ?").get(result.runId)).toEqual({ status: "failed" });
  }, (path) => path === "/test/Events" ? Response.json([{ EventId: 1 }]) : new Response("missing", { status: 404 }));
});

test("explicit empty body lists all bodies and empty output is retained in the summary", async () => {
  await fixture(async (ctx) => {
    const result = await ingestMeeting(ctx, { date: "2026-01-01", body: "", output: "" });
    expect(result.status).toBe("succeeded");
    expect(result.outputDirectory).toBe("");
    expect(saved(ctx, result.runId)).toEqual(result);
  }, (path) => path.endsWith("EventItems") ? Response.json([]) : Response.json([{ EventId: 1, EventBodyName: "Housing Committee", EventDate: "2026-01-01" }]));
});

test("meeting summary reports overridden output directory on disk as well as return value", async () => {
  await fixture(async (ctx) => {
    const output = join(ctx.config.documentStorePath, "override");
    const result = await ingestMeeting(ctx, { eventId: 1, output });
    expect(result.status).toBe("succeeded");
    expect(result.outputDirectory).toBe(output);
    expect(saved(ctx, result.runId)).toEqual(result);
  }, (path) => Response.json(path.endsWith("EventItems") ? [] : { EventId: 1 }));
});
