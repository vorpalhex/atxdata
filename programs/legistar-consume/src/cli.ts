#!/usr/bin/env bun
import { Command } from "commander";
import { parseArgs } from "node:util";
import { open, readFile } from "node:fs/promises";
import { LegistarApiClient } from "./legistar/api-client";
import { createHttpClient } from "./util/http";
import { loadConfig, resolveConfig } from "./config";
import { backfill, ingestMeeting, listMeetings } from "./jobs/ingest";
import { AppDatabase } from "./storage/db";
import { parsePositiveInteger } from "./util/integers";
import { calendarRange } from "./legistar/listing";
import { version } from "../package.json";
import { CheckedOutput } from "./util/output";
import { setLogWriter } from "./util/logger";

const output = new CheckedOutput();
const diagnostics = new CheckedOutput(2);
setLogWriter(output.line);
const program = new Command();
program.configureOutput({ writeOut: output.text, writeErr: diagnostics.text }).exitOverride();

program
  .name("legistar-consume")
  .description("Download Austin Legistar meeting documents to disk")
  .version(version);

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
    calendarRange(options.from, options.to);
    const prior = options.resume ? JSON.parse(await readFile(options.resume, "utf8")) : undefined;
    if (options.resume !== undefined && (!prior || typeof prior !== "object" || Array.isArray(prior) || prior.complete !== false || !prior.continuation || typeof prior.continuation !== "object" || Array.isArray(prior.continuation))) throw new Error("invalid or completed checkpoint");
    const config = resolveConfig();
    new LegistarApiClient(config, {} as ReturnType<typeof createHttpClient>).validateListing(options.from,options.to,options.body,{pageSize:options.pageSize,continuation:prior?.continuation});
    loadConfig(config);
    const handle = await open(options.checkpoint, "wx", 0o600);
    try {
      const http = createHttpClient(config, {info:()=>{},warn:()=>{},error:()=>{}});
      const result = await new LegistarApiClient(config,http).listEventsPage(options.from,options.to,options.body,{
        maxPages:options.maxPages,pageSize:options.pageSize,continuation:prior?.continuation,
      });
      const json=JSON.stringify(result);
      await handle.writeFile(json+"\n"); await handle.sync(); output.line(json);
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
    calendarRange(options.from, options.to);
    const ctx = makeContext();
    const meetings = await listMeetings(ctx, options.from, options.to, options.body, options);
    for (const meeting of meetings) {
      output.line(
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
      await output.flush();
    }
  });

program
  .command("ingest-meeting")
  .option("--event-id <id>", "Legistar API event id", parsePositiveInteger)
  .option("--date <date>", "meeting date YYYY-MM-DD; --event-id takes precedence when both are supplied (stderr warning)")
  .option("--body <name>", "meeting body name", "City Council")
  .option("--output <path>", "document output directory")
  .option("--concurrency <count>", "download concurrency", parsePositiveInteger)
  .action(async (options) => {
    if (options.eventId === undefined && options.date === undefined) throw new Error("Provide --event-id or --date; see ingest-meeting --help");
    if (options.eventId === undefined && options.date !== undefined) calendarRange(options.date, options.date);
    if (options.eventId !== undefined && options.date !== undefined) diagnostics.line(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "cli.selector-precedence", selector: "event-id", ignored: "date" }));
    const ctx = makeContext();
    const summary = await ingestMeeting(ctx, {
      eventId: options.eventId,
      date: options.date,
      body: options.body,
      output: options.output,
      concurrency: options.concurrency,
    });
    output.line(JSON.stringify({ event: "run.summary", ...summary }));
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
    calendarRange(options.from, options.to);
    const ctx = makeContext();
    const summary = await backfill(ctx, options.from, options.to, options.body, options);
    output.line(JSON.stringify({ event: "run.summary", ...summary }));
    process.exitCode = summary.status === "succeeded" ? 0 : 1;
  });

program.command("retry-failed").action(async () => {
  throw new Error("retry-failed is not implemented yet");
});

/** Commander treats root operands after -- as subcommand selectors. Guard that
 * boundary with tokens derived from the existing option declarations, never a
 * raw argv search (required values may themselves look like help/commands). */
function tokenOptions() {
  const options: Record<string, { type: "string" | "boolean"; short?: string }> = { help: { type: "boolean", short: "h" } };
  for (const option of [...program.options, ...program.commands.flatMap(command => command.options)]) {
    if (option.long) options[option.long.slice(2)] = { type: option.required || option.optional ? "string" : "boolean", ...(option.short ? { short: option.short.slice(1) } : {}) };
  }
  return options;
}
function boundaryTokens(args: string[]) {
  try { return parseArgs({ args, options: tokenOptions(), allowPositionals: true, strict: false, tokens: true }).tokens; }
  catch { return undefined; } // Let Commander retain its established usage diagnostics.
}
export function rejectProtectedSelectors(args: string[]): void {
  const tokens = boundaryTokens(args);
  if (!tokens) return;
  const boundary = tokens.find(token => token.kind === "option-terminator")?.index;
  if (boundary === undefined) return;
  const operands = tokens.filter(token => token.kind === "positional");
  if (operands[0] && (operands[0].index > boundary || (operands[0].value === "help" && operands.some(token => token.index > boundary)))) {
    throw new Error("Unexpected protected operand; use --help before the option boundary");
  }
}

async function flushOutputs(): Promise<void> {
  const results = await Promise.allSettled([output.flush(), diagnostics.flush()]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
}

export async function main(argv: string[] = process.argv) {
  try {
    rejectProtectedSelectors(argv.slice(2));
    await program.parseAsync(argv);
    await flushOutputs();
  } catch (error) {
    const failure = error as Error & { code?: string; exitCode?: number };
    if (failure.code?.startsWith("commander.")) {
      try { await flushOutputs(); } catch (delivery) { return fail(delivery); }
      process.exitCode = failure.exitCode ?? 1;
      return;
    }
    await fail(failure);
  }
}
async function fail(error: unknown): Promise<never> {
  diagnostics.line(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "cli.failed", error: error instanceof Error ? error.message : "operation failed" }));
  // A failed stderr sink is terminal: observe both queues, never report its
  // failure back into itself or expose a rejected flush as an uncaught error.
  await Promise.allSettled([output.flush(), diagnostics.flush()]);
  process.exit(1);
}
if (import.meta.main) void main();

function makeContext() {
  const config = loadConfig();
  const db = new AppDatabase(config);
  db.migrate();
  return { config, db };
}

