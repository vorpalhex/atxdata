#!/usr/bin/env bun
import { Command } from "commander";
import { open, readFile } from "node:fs/promises";
import { LegistarApiClient } from "./legistar/api-client";
import { createHttpClient } from "./util/http";
import { loadConfig } from "./config";
import { backfill, ingestMeeting, listMeetings, retryFailed } from "./jobs/ingest";
import { AppDatabase } from "./storage/db";
import { parsePositiveInteger } from "./util/integers";

const program = new Command();

program
  .name("legistar-consume")
  .description("Download Austin Legistar meeting documents to disk")
  .version("0.1.0");

program
  .command("list-meetings-page")
  .requiredOption("--from <date>", "start date YYYY-MM-DD")
  .requiredOption("--to <date>", "end date YYYY-MM-DD")
  .requiredOption("--checkpoint <path>", "new private batch/checkpoint JSON output (never overwritten)")
  .option("--resume <path>", "previous incomplete batch JSON")
  .option("--body <name>", "meeting body name")
  .option("--page-size <count>", "requested collection page size", parsePositiveInteger, 100)
  .option("--max-pages <count>", "maximum requests this batch including terminal empty page", parsePositiveInteger, 100)
  .action(async options => {
    const prior = options.resume ? JSON.parse(await readFile(options.resume, "utf8")) : undefined;
    if (options.resume !== undefined && (!prior || typeof prior !== "object" || Array.isArray(prior) || prior.complete !== false || !prior.continuation || typeof prior.continuation !== "object" || Array.isArray(prior.continuation))) throw new Error("invalid or completed checkpoint");
    const config = loadConfig();
    new LegistarApiClient(config, {} as ReturnType<typeof createHttpClient>).validateListing(options.from,options.to,options.body,{pageSize:options.pageSize,continuation:prior?.continuation});
    const handle = await open(options.checkpoint, "wx", 0o600);
    try {
      const http = createHttpClient(config, {info:()=>{},warn:()=>{},error:()=>{}});
      const result = await new LegistarApiClient(config,http).listEventsPage(options.from,options.to,options.body,{
        maxPages:options.maxPages,pageSize:options.pageSize,continuation:prior?.continuation,
      });
      const json=JSON.stringify(result);
      await handle.writeFile(json+"\n"); await handle.sync(); console.log(json);
    } finally {await handle.close();}
  });

program
  .command("list-meetings")
  .requiredOption("--from <date>", "start date YYYY-MM-DD")
  .requiredOption("--to <date>", "end date YYYY-MM-DD")
  .option("--body <name>", "meeting body name")
  .option("--max-pages <count>", "maximum listing requests", parsePositiveInteger)
  .option("--page-size <count>", "listing page size", parsePositiveInteger)
  .action(async (options) => {
    const ctx = makeContext();
    const meetings = await listMeetings(ctx, options.from, options.to, options.body, options);
    for (const meeting of meetings) {
      console.log(
        JSON.stringify({
          eventId: meeting.eventId,
          date: meeting.meetingDate,
          time: meeting.meetingTime,
          body: meeting.bodyName,
          agendaStatus: meeting.agendaStatus,
          minutesStatus: meeting.minutesStatus,
          location: meeting.location,
        }),
      );
    }
  });

program
  .command("ingest-meeting")
  .option("--event-id <id>", "Legistar API event id", parsePositiveInteger)
  .option("--date <date>", "meeting date YYYY-MM-DD")
  .option("--body <name>", "meeting body name", "City Council")
  .option("--output <path>", "document output directory")
  .option("--concurrency <count>", "download concurrency", parsePositiveInteger)
  .action(async (options) => {
    const ctx = makeContext();
    const summary = await ingestMeeting(ctx, {
      eventId: options.eventId,
      date: options.date,
      body: options.body,
      output: options.output,
      concurrency: options.concurrency,
    });
    console.log(JSON.stringify({ event: "run.summary", ...summary }));
    process.exitCode = summary.status === "succeeded" ? 0 : 1;
  });

program
  .command("backfill")
  .requiredOption("--from <date>", "start date YYYY-MM-DD")
  .requiredOption("--to <date>", "end date YYYY-MM-DD")
  .option("--body <name>", "meeting body name")
  .option("--max-pages <count>", "maximum listing requests", parsePositiveInteger)
  .option("--page-size <count>", "listing page size", parsePositiveInteger)
  .action(async (options) => {
    const ctx = makeContext();
    const summary = await backfill(ctx, options.from, options.to, options.body, options);
    console.log(JSON.stringify({ event: "run.summary", ...summary }));
    process.exitCode = summary.status === "succeeded" ? 0 : 1;
  });

program.command("retry-failed").action(async () => {
  const ctx = makeContext();
  await retryFailed(ctx);
});

program.parseAsync(process.argv).catch((error) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "cli.failed", error: error.message }));
  process.exit(1);
});

function makeContext() {
  const config = loadConfig();
  const db = new AppDatabase(config);
  db.migrate();
  return { config, db };
}

