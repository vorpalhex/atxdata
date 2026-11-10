#!/usr/bin/env bun
import { Command } from "commander";
import { readFile, open } from "node:fs/promises";
import { CivicClerkClient, calendarDate } from "./client";
import { PoliteHttpClient } from "./http";
import { version } from "../package.json";
import { CheckedOutput } from "../../legistar-consume/src/util/output";

const optionDefinitions = [
  ["--from <date>", "inclusive start date YYYY-MM-DD"],
  ["--to <date>", "inclusive end date YYYY-MM-DD"],
  ["--event-id <id>", "public meeting event ID"],
  ["--output <directory>", "approved absolute private archive"],
  ["--max-bytes <count>", "byte budget (default 12 MiB)"],
  ["--max-documents <count>", "document budget (default 100)"],
  ["--file-types <types>", "PDF classes (default 1,2,4,5)"],
  ["--max-pages <count>", "request budget (default 20)"],
  ["--checkpoint <path>", "new durable batch JSON; never overwritten"],
  ["--resume <path>", "prior incomplete batch JSON"],
] as const;

export function createProgram(messages: string[] = []): Command {
  const program = new Command()
    .name("civicclerk-consume")
    .description("List public meeting IDs and archive published PDFs")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        messages.push(text);
      },
      writeErr: (text) => {
        messages.push(text);
      },
    })
    .option("-h, --help", "display help")
    .option("--version", "display package version");
  for (const [flags, description] of optionDefinitions)
    program.option(flags, description);
  const list = program
    .command("list-meetings")
    .description(
      "Inclusive dates; default 20 requests. JSON array, or durable batch JSON with --checkpoint.",
    );
  const ingest = program
    .command("ingest-meeting")
    .description(
      "Use an approved absolute private archive. Defaults: 12 MiB, 100 documents, PDF types 1,2,4,5. JSON result.",
    );
  for (const command of [list, ingest]) {
    const names =
      command === list
        ? ["from", "to", "max-pages", "checkpoint", "resume"]
        : ["event-id", "output", "max-bytes", "max-documents", "file-types"];
    for (const [flags, description] of optionDefinitions) {
      if (names.includes(flags.split(" ")[0]!.slice(2)))
        command.option(flags, description);
    }
  }
  list.addHelpText(
    "after",
    "Example: civicclerk-consume list-meetings --from 2021-01-05 --to 2021-01-05",
  );
  ingest.addHelpText(
    "after",
    "Example: civicclerk-consume ingest-meeting --event-id 59 --output /approved/private/archive",
  );
  program.addHelpText(
    "after",
    "Use help COMMAND or COMMAND -h/--help. Options accept equals or split values on either side of a command; singleton options cannot repeat. -- ends option parsing. No prompts or stdin input.\nExample: civicclerk-consume list-meetings --from 2021-01-05 --to 2021-01-05",
  );
  return program;
}
function help(program: Command, command?: string): string {
  const target =
    program.commands.find((item) => item.name() === command) ?? program;
  const rendered: string[] = [];
  target.configureOutput({
    writeOut: (text) => {
      rendered.push(text);
    },
    writeErr: (text) => {
      rendered.push(text);
    },
  });
  target.outputHelp();
  return (
    "civicclerk-consume — list public meeting IDs and archive published PDFs\n" +
    rendered.join("")
  );
}

const usage =
  "Usage: list-meetings --from YYYY-MM-DD --to YYYY-MM-DD [--max-pages N] [--checkpoint NEW.json [--resume PRIOR.json]] | ingest-meeting --event-id ID --output DIRECTORY [--max-bytes N] [--max-documents N] [--file-types 1,2,4,5]";
export function httpSetting(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error(`invalid option ${name}`);
  return Number(value);
}
function makeClient(): CivicClerkClient {
  return new CivicClerkClient(
    new PoliteHttpClient({
      maxRetries: httpSetting("HTTP_MAX_RETRIES"),
      timeoutMs: httpSetting("HTTP_TIMEOUT_MS"),
      minIntervalMs: httpSetting("HTTP_MIN_INTERVAL_MS"),
      userAgent: process.env.HTTP_USER_AGENT,
    }),
    process.env.CIVICCLERK_API_BASE,
  );
}
function dateRange(from: string, to: string): void {
  calendarDate(from);
  calendarDate(to);
  if (from > to) throw new Error("reversed date range");
}
function eventId(value: string | undefined): number {
  if (
    !value ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error("invalid event ID");
  return Number(value);
}
function requireOptions(
  values: Record<string, string | undefined>,
  required: string[],
  optional: string[] = [],
): void {
  if (
    required.some((key) => !values[key]) ||
    Object.keys(values).some((key) => ![...required, ...optional].includes(key))
  )
    throw new Error(usage);
}
function limit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error("invalid work limit");
  return Number(value);
}
function fileTypes(value: string | undefined): number[] | undefined {
  if (value === undefined) return undefined;
  if (!/^[1245](,[1245])*$/.test(value))
    throw new Error(
      "unsupported file types: supported PDF classes are 1,2,4,5",
    );
  return [...new Set(value.split(",").map(Number))];
}
type CliClient = Pick<CivicClerkClient, "listEvents" | "downloadEvent"> &
  Partial<Pick<CivicClerkClient, "listEventsPage" | "validateListing">>;
async function persistListing(
  checkpoint: string,
  prior: Awaited<ReturnType<typeof readCheckpoint>>,
  api: CliClient,
  range: { from: string; to: string; maxPages?: number },
  write: (line: string) => void,
): Promise<void> {
  api.validateListing?.(range.from, range.to, prior?.continuation);
  // Reserve a new output before transport; never clobber an earlier batch.
  const handle = await open(checkpoint, "wx", 0o600);
  try {
    if (!api.listEventsPage) throw new Error("paged client unavailable");
    const result = await api.listEventsPage(range.from, range.to, {
      maxPages: range.maxPages,
      continuation: prior?.continuation,
    });
    const json = JSON.stringify(result);
    await handle.writeFile(json + "\n");
    await handle.sync();
    write(json);
  } finally {
    await handle.close();
  }
}
function checkpointObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function readCheckpoint(path: string | undefined) {
  if (path === undefined) return undefined;
  const prior = JSON.parse(await readFile(path, "utf8"));
  if (
    !checkpointObject(prior) ||
    prior.complete !== false ||
    !checkpointObject(prior.continuation)
  )
    throw new Error("invalid or completed checkpoint");
  return prior as { continuation: import("./client").ListingContinuation };
}
function listingClient(
  from: string,
  to: string,
  saved?: import("./client").ListingContinuation,
): CivicClerkClient {
  // Reuse the listing validator without constructing the real HTTP transport.
  const unavailable = async (): Promise<never> => {
    throw new Error("validation cannot perform HTTP");
  };
  new CivicClerkClient(
    { getJson: unavailable, request: unavailable },
    process.env.CIVICCLERK_API_BASE,
  ).validateListing(from, to, saved);
  return makeClient();
}
async function listCommand(
  values: Record<string, string | undefined>,
  client: CliClient | undefined,
  write: (line: string) => void,
): Promise<void> {
  requireOptions(values, ["from", "to"], ["max-pages", "checkpoint", "resume"]);
  const from = values.from ?? "",
    to = values.to ?? "";
  dateRange(from, to);
  const maxPages = limit(values["max-pages"]);
  if (maxPages === 0) throw new Error("invalid page budget");
  if (values.resume && !values.checkpoint)
    throw new Error("resume requires a new checkpoint output");
  const prior = await readCheckpoint(values.resume);
  const api = client ?? listingClient(from, to, prior?.continuation);
  if (values.checkpoint) {
    await persistListing(
      values.checkpoint,
      prior,
      api,
      { from, to, maxPages },
      write,
    );
  } else {
    write(JSON.stringify(await api.listEvents(from, to, { maxPages })));
  }
}
function parseCli(args: string[]) {
  const program = createProgram();
  const seen = new Set<string>();
  let duplicate: string | undefined;
  for (const option of program.options) {
    program.on(`option:${option.name()}`, () => {
      if (seen.has(option.name())) duplicate ??= option.name();
      seen.add(option.name());
    });
  }
  // Node's published split-value contract rejects option-looking string values.
  // Commander consumes them, so retain just this narrow ambiguity guard.
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      if (index < args.length - 1) throw new Error(usage);
      break;
    }
    if (
      program.options.some((option) => option.required && option.long === arg)
    ) {
      if (args[index + 1] !== "-" && args[index + 1]?.startsWith("-"))
        throw new Error(
          "invalid option value; use equals syntax for option-like values",
        );
      index++;
    }
  }
  const parsed = program.parseOptions(args);
  if (parsed.unknown.length) throw new Error("Unknown option; use --help");
  const values = program.opts<Record<string, string | boolean>>();
  const positionals = parsed.operands;
  let text: string | undefined;
  if (positionals[0] === "help") {
    if (
      positionals.length > 2 ||
      (positionals[1] &&
        !program.commands.some((command) => command.name() === positionals[1]))
    )
      throw new Error(usage);
    text = help(program, positionals[1]);
  } else if (values.help) text = help(program, positionals[0]);
  else if (values.version) text = `civicclerk-consume ${version}`;
  if (text === undefined && duplicate)
    throw new Error(`duplicate option ${duplicate}`);
  const { help: _help, version: _version, ...options } = values;
  // Preserve the existing domain option keys; Commander owns their consumption.
  const domain: Record<string, string | undefined> = {};
  for (const option of program.options) {
    if (option.required && options[option.attributeName()] !== undefined)
      domain[option.name()] = options[option.attributeName()] as string;
  }
  return { program, positionals, values: domain, text };
}
async function ingestCommand(
  values: Record<string, string | undefined>,
  client: CliClient | undefined,
  write: (line: string) => void,
): Promise<void> {
  requireOptions(
    values,
    ["event-id", "output"],
    ["max-bytes", "max-documents", "file-types"],
  );
  const id = eventId(values["event-id"]);
  const options = {
    maxBytes: limit(values["max-bytes"]),
    maxDocuments: limit(values["max-documents"]),
    fileTypes: fileTypes(values["file-types"]),
  };
  write(
    JSON.stringify(
      await (client ?? makeClient()).downloadEvent(
        id,
        values.output ?? "",
        options,
      ),
    ),
  );
}
export async function runCli(
  args: string[],
  client?: Pick<CivicClerkClient, "listEvents" | "downloadEvent"> &
    Partial<Pick<CivicClerkClient, "listEventsPage">>,
  write: (line: string) => void = console.log,
): Promise<void> {
  const { program, positionals, values, text } = parseCli(args);
  if (text !== undefined) {
    write(text);
    return;
  }
  if (
    positionals.length !== 1 ||
    !program.commands.some((command) => command.name() === positionals[0])
  )
    throw new Error(usage);
  program.commands
    .find((command) => command.name() === "list-meetings")!
    .action(() => listCommand(values, client, write));
  program.commands
    .find((command) => command.name() === "ingest-meeting")!
    .action(() => ingestCommand(values, client, write));
  // Options were consumed by Commander above to retain legacy information
  // precedence and permissive placement. Commander now dispatches the command.
  await program.parseAsync(positionals, { from: "user" });
}
if (import.meta.main) {
  const output = new CheckedOutput();
  const diagnostics = new CheckedOutput(2);
  runCli(process.argv.slice(2), undefined, output.line)
    .then(() => output.flush())
    .catch(async (error) => {
      diagnostics.line(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await Promise.allSettled([output.flush(), diagnostics.flush()]);
      process.exit(1);
    });
}
