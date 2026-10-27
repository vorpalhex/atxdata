#!/usr/bin/env bun
import { Command } from "commander";
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
  .command("list-meetings")
  .requiredOption("--from <date>", "start date YYYY-MM-DD")
  .requiredOption("--to <date>", "end date YYYY-MM-DD")
  .option("--body <name>", "meeting body name")
  .action(async (options) => {
    const ctx = makeContext();
    const meetings = await listMeetings(ctx, options.from, options.to, options.body);
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
  .action(async (options) => {
    const ctx = makeContext();
    const summary = await backfill(ctx, options.from, options.to, options.body);
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

