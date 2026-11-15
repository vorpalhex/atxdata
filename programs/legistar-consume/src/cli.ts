#!/usr/bin/env bun
import type { NormalizedMeeting, RunSummary } from "./types";
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

function relativeDays(value: string): number | undefined {
  const named: Record<string, number> = {
    today: 0,
    yesterday: -1,
    tomorrow: 1,
  };
  const relative = /^([+-]?\d+) (day|week)s?$/.exec(value);
  const ago = /^(\d+) (day|week)s? ago$/.exec(value);
  const future = /^in (\d+) (day|week)s?$/.exec(value);
  const match = relative ?? ago ?? future;
  if (!match) return named[value];
  return Number(match[1]) * (match[2] === "week" ? 7 : 1) * (ago ? -1 : 1);
}

/** CLI-only vocabulary; library listing dates remain strict ISO strings. */
export function resolveCliDate(value: string, now = new Date()): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    calendarRange(value, value);
    return value;
  }
  const days = relativeDays(value);
  if (
    days === undefined ||
    !Number.isSafeInteger(days) ||
    Math.abs(days) > 36500
  )
    throw new Error(
      `Invalid date '${value}'; use YYYY-MM-DD, today/yesterday/tomorrow, or relative days/weeks (at most 36500 days)`,
    );
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const result = `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  calendarRange(result, result);
  return result;
}

function humanMeeting(meeting: NormalizedMeeting): string {
  return `${meeting.meetingDate}  ${meeting.meetingTime ?? "Time TBD"}  ${meeting.bodyName}  (event ${meeting.eventId})\n  Location: ${meeting.location ?? "Not specified"}\n  Agenda: ${meeting.agendaStatus ?? "Unknown"}; minutes: ${meeting.minutesStatus ?? "Unknown"}`;
}

const output = new CheckedOutput();
const diagnostics = new CheckedOutput(2);
type ParserMessages = { stdout: string; stderr: string };
interface RangeOptions {
  from: string;
  to: string;
  body?: string;
  maxPages?: number;
  pageSize?: number;
}
interface PageOptions extends RangeOptions {
  checkpoint: string;
  resume?: string;
  maxPages: number;
  pageSize: number;
}
interface IngestOptions {
  eventId?: number;
  date?: string;
  body: string;
  output?: string;
  concurrency?: number;
}

export function createProgram(
  messages: ParserMessages = { stdout: "", stderr: "" },
): Command {
  const program = configureProgram(messages);
  registerPageCommand(program);
  registerListCommand(program);
  registerIngestCommand(program);
  registerBackfillCommand(program);
  program.command("retry-failed").action(async () => {
    throw new Error("retry-failed is not implemented yet");
  });
  addCommandHelp(program);
  program.hook("preAction", (_root, command) => {
    if (["list-meetings", "backfill"].includes(command.name())) {
      const now = new Date();
      for (const key of ["from", "to"]) {
        command.setOptionValue(key, resolveCliDate(command.opts()[key], now));
      }
    }
  });
  return program;
}

function configureProgram(messages: ParserMessages): Command {
  const program = new Command();
  program
    .configureHelp({ showGlobalOptions: true })
    .configureOutput({
      writeOut: (text) => {
        messages.stdout += text;
      },
      writeErr: (text) => {
        messages.stderr += text;
      },
    })
    .exitOverride();

  program
    .name("legistar-consume")
    .description("Download Austin Legistar meeting documents to disk")
    .version(version)
    .addHelpCommand(true)
    .option("--json", "machine output: NDJSON meetings or a JSON summary/batch")
    .addHelpText(
      "after",
      `
Examples:
  legistar-consume list-meetings
  legistar-consume list-meetings --to='30 days' --body='City Council'
  legistar-consume ingest-meeting --event-id=59
  legistar-consume --json list-meetings --from=2021-01-01 --to=2021-01-31

Results go to stdout; diagnostics and progress go to stderr.
Use help COMMAND for details. See README.md for dates and stream contracts.
`,
    )
    .action(() => {
      program.outputHelp();
    });

  return program;
}

function renderSummary(program: Command, summary: RunSummary) {
  output.line(
    program.opts().json
      ? JSON.stringify({ event: "run.summary", ...summary })
      : `Run ${summary.runId}: ${summary.status}\nMeetings: ${summary.meetingsProcessed}/${summary.meetingsDiscovered} processed\nDocuments: ${summary.documentsDownloaded} downloaded, ${summary.documentsSkipped} skipped, ${summary.documentsFailed} failed (${summary.totalBytes} bytes)\nOutput: ${summary.outputDirectory}`,
  );
  if (!program.opts().json) {
    for (const failure of summary.failures) {
      output.line(`  Failure: ${failure.title}: ${failure.error}`);
    }
  }
}

function registerPageCommand(program: Command) {
  program
    .command("list-meetings-page")
    .requiredOption("--from <date>", "start date YYYY-MM-DD")
    .requiredOption("--to <date>", "end date YYYY-MM-DD")
    .requiredOption(
      "--checkpoint <path>",
      "new private batch/checkpoint JSON output (never overwritten)",
    )
    .option("--resume <path>", "previous incomplete batch JSON")
    .option("--body <name>", "meeting body name")
    .option(
      "--page-size <count>",
      "requested collection page size",
      parsePositiveInteger,
      100,
    )
    .option(
      "--max-pages <count>",
      "maximum requests this batch including terminal empty page",
      parsePositiveInteger,
      100,
    )
    .action((options: PageOptions) => runPage(program, options));
}

function isRecord(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readCheckpoint(path: string | undefined) {
  if (path === undefined) return undefined;
  // The API client's validateListing below validates the continuation fields.
  const prior = JSON.parse(await readFile(path, "utf8"));
  if (
    !isRecord(prior) ||
    prior.complete !== false ||
    !isRecord(prior.continuation)
  )
    throw new Error("invalid or completed checkpoint");
  return prior;
}

async function runPage(program: Command, options: PageOptions) {
  calendarRange(options.from, options.to);
  const prior = await readCheckpoint(options.resume);
  const config = resolveConfig();
  new LegistarApiClient(
    config,
    {} as ReturnType<typeof createHttpClient>,
  ).validateListing(options.from, options.to, options.body, {
    pageSize: options.pageSize,
    continuation: prior?.continuation,
  });
  loadConfig(config);
  const handle = await open(options.checkpoint, "wx", 0o600);
  try {
    const http = createHttpClient(config, {
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    const result = await new LegistarApiClient(config, http).listEventsPage(
      options.from,
      options.to,
      options.body,
      {
        maxPages: options.maxPages,
        pageSize: options.pageSize,
        continuation: prior?.continuation,
      },
    );
    const json = JSON.stringify(result);
    await handle.writeFile(json + "\n");
    await handle.sync();
    if (program.opts().json) output.line(json);
    else {
      output.line(
        `${result.meetings.length} meeting(s); ${result.complete ? "complete" : "incomplete — resume with the same dates, body and page size"}\nCheckpoint: ${options.checkpoint}`,
      );
      for (const meeting of result.meetings) {
        output.line(humanMeeting(meeting));
        await output.flush();
      }
    }
  } finally {
    await handle.close();
  }
}

function registerListCommand(program: Command) {
  program
    .command("list-meetings")
    .description(
      "Discover meeting IDs (default: last 30 days through next 30 days)",
    )
    .option(
      "--from <date>",
      "inclusive start: ISO or relative date",
      "-30 days",
    )
    .option("--to <date>", "inclusive end: ISO or relative date", "30 days")
    .option("--body <name>", "meeting body name")
    .option(
      "--max-pages <count>",
      "maximum listing requests",
      parsePositiveInteger,
    )
    .option("--page-size <count>", "listing page size", parsePositiveInteger)
    .action((options: RangeOptions) => runList(program, options));
}

async function runList(program: Command, options: RangeOptions) {
  calendarRange(options.from, options.to);
  const ctx = makeContext();
  const meetings = await listMeetings(
    ctx,
    options.from,
    options.to,
    options.body,
    options,
  );
  if (!program.opts().json) {
    output.line(
      `${meetings.length} meeting(s) (${options.from} through ${options.to})`,
    );
  }
  for (const meeting of meetings) {
    output.line(
      program.opts().json
        ? JSON.stringify({
            eventId: meeting.eventId,
            date: meeting.meetingDate,
            time: meeting.meetingTime,
            body: meeting.bodyName,
            agendaStatus: meeting.agendaStatus,
            minutesStatus: meeting.minutesStatus,
            location: meeting.location,
          })
        : humanMeeting(meeting),
    );
    await output.flush();
  }
}

function registerIngestCommand(program: Command) {
  program
    .command("ingest-meeting")
    .option("--event-id <id>", "Legistar API event id", parsePositiveInteger)
    .option(
      "--date <date>",
      "meeting date YYYY-MM-DD; --event-id takes precedence when both are supplied (stderr warning)",
    )
    .option("--body <name>", "meeting body name", "City Council")
    .option("--output <path>", "document output directory")
    .option(
      "--concurrency <count>",
      "download concurrency",
      parsePositiveInteger,
    )
    .action((options: IngestOptions) => runIngest(program, options));
}

async function runIngest(program: Command, options: IngestOptions) {
  if (options.eventId === undefined && options.date === undefined)
    throw new Error("Provide --event-id or --date; see ingest-meeting --help");
  if (options.eventId === undefined && options.date !== undefined) {
    options.date = resolveCliDate(options.date);
    calendarRange(options.date, options.date);
  }
  if (options.eventId !== undefined && options.date !== undefined)
    diagnostics.line(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        event: "cli.selector-precedence",
        selector: "event-id",
        ignored: "date",
      }),
    );
  const ctx = makeContext();
  const summary = await ingestMeeting(ctx, {
    eventId: options.eventId,
    date: options.date,
    body: options.body,
    output: options.output,
    concurrency: options.concurrency,
  });
  renderSummary(program, summary);
  process.exitCode = summary.status === "succeeded" ? 0 : 1;
}

function registerBackfillCommand(program: Command) {
  program
    .command("backfill")
    .requiredOption("--from <date>", "start date YYYY-MM-DD")
    .requiredOption("--to <date>", "end date YYYY-MM-DD")
    .option("--body <name>", "meeting body name")
    .option(
      "--max-pages <count>",
      "maximum listing requests",
      parsePositiveInteger,
    )
    .option("--page-size <count>", "listing page size", parsePositiveInteger)
    .action((options: RangeOptions) => runBackfill(program, options));
}

async function runBackfill(program: Command, options: RangeOptions) {
  calendarRange(options.from, options.to);
  const ctx = makeContext();
  const summary = await backfill(
    ctx,
    options.from,
    options.to,
    options.body,
    options,
  );
  renderSummary(program, summary);
  process.exitCode = summary.status === "succeeded" ? 0 : 1;
}

function addCommandHelp(program: Command) {
  const dateHelp =
    "Dates: strict YYYY-MM-DD, today/yesterday/tomorrow, [+-]N days/weeks, N days/weeks ago, or in N days/weeks. Relative offsets are limited to 36500 days and use the local calendar day. Both ends are inclusive.";
  for (const command of program.commands) {
    command.description(
      command.description() ||
        ({
          "list-meetings-page":
            "List one bounded batch with an exclusive private JSON checkpoint (explicit ISO dates required)",
          "ingest-meeting": "Download one meeting selected by event ID or date",
          backfill: "Download a range of meetings (both dates required)",
          "retry-failed": "Reserved command; not implemented",
        }[command.name()] ??
          ""),
    );
    command.addHelpText(
      "after",
      `\nResults are human-readable by default. --json works before or after the command; logs always use stderr.\n${command.name() === "list-meetings-page" ? "Dates must be explicit YYYY-MM-DD so resume queries stay stable. Checkpoints always contain JSON, regardless of stdout mode." : dateHelp}\n\nExamples:\n  legistar-consume ${command.name()} ${
        {
          "list-meetings": "--to='30 days' --body='City Council'",
          "list-meetings-page":
            "--from=2021-01-01 --to=2021-01-31 --checkpoint=batch-1.json",
          "ingest-meeting": "--event-id=59",
          backfill: "--from=2021-01-01 --to=2021-01-31",
          "retry-failed": "--help",
        }[command.name()] ?? ""
      }\n`,
    );
  }
}

/** Commander treats root operands after -- as subcommand selectors. Guard that
 * boundary with tokens derived from the existing option declarations, never a
 * raw argv search (required values may themselves look like help/commands). */
function tokenOptions(program: Command) {
  const options: Record<
    string,
    { type: "string" | "boolean"; short?: string }
  > = { help: { type: "boolean", short: "h" } };
  for (const option of [
    ...program.options,
    ...program.commands.flatMap((command) => command.options),
  ]) {
    if (option.long)
      options[option.long.slice(2)] = {
        type: option.required || option.optional ? "string" : "boolean",
        ...(option.short ? { short: option.short.slice(1) } : {}),
      };
  }
  return options;
}
function boundaryTokens(args: string[], program: Command) {
  try {
    return parseArgs({
      args,
      options: tokenOptions(program),
      allowPositionals: true,
      strict: false,
      tokens: true,
    }).tokens;
  } catch {
    return undefined;
  } // Let Commander retain its established usage diagnostics.
}
export function rejectProtectedSelectors(
  args: string[],
  program = createProgram(),
): void {
  const tokens = boundaryTokens(args, program);
  if (!tokens) return;
  const boundary = tokens.find(
    (token) => token.kind === "option-terminator",
  )?.index;
  if (boundary === undefined) return;
  const operands = tokens.filter((token) => token.kind === "positional");
  if (
    operands[0] &&
    (operands[0].index > boundary ||
      (operands[0].value === "help" &&
        operands.some((token) => token.index > boundary)))
  ) {
    throw new Error(
      "Unexpected protected operand; use --help before the option boundary",
    );
  }
}

async function flushOutputs(): Promise<void> {
  const results = await Promise.allSettled([
    output.flush(),
    diagnostics.flush(),
  ]);
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}

export async function main(argv: string[] = process.argv) {
  setLogWriter(diagnostics.line);
  const messages: ParserMessages = { stdout: "", stderr: "" };
  const program = createProgram(messages);
  // Commander renders into memory; only the existing checked queues touch fds.
  const deliverParser = () => {
    output.text(messages.stdout);
    diagnostics.text(messages.stderr);
    messages.stdout = "";
    messages.stderr = "";
  };
  try {
    rejectProtectedSelectors(argv.slice(2), program);
    await program.parseAsync(argv);
    deliverParser();
    await flushOutputs();
  } catch (error) {
    deliverParser();
    const failure = error as Error & { code?: string; exitCode?: number };
    if (failure.code?.startsWith("commander.")) {
      try {
        await flushOutputs();
      } catch (delivery) {
        return fail(delivery);
      }
      process.exitCode = failure.exitCode ?? 1;
      return;
    }
    await fail(failure);
  }
}
async function fail(error: unknown): Promise<never> {
  diagnostics.line(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "cli.failed",
      error: error instanceof Error ? error.message : "operation failed",
    }),
  );
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
