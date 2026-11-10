#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { readFile, open } from "node:fs/promises";
import { CivicClerkClient, calendarDate } from "./client";
import { PoliteHttpClient } from "./http";
import { version } from "../package.json";
import { CheckedOutput } from "../../legistar-consume/src/util/output";

function help(command?: string): string {
  const intro = "civicclerk-consume — list public meeting IDs and archive published PDFs\n";
  if (command === "list-meetings") return intro + "Usage: civicclerk-consume list-meetings --from YYYY-MM-DD --to YYYY-MM-DD [--max-pages N] [--checkpoint NEW.json [--resume PRIOR.json]]\nInclusive dates; default 20 requests. JSON array, or durable batch JSON with --checkpoint. New checkpoints never overwrite.\nExample: list-meetings --from 2021-01-05 --to 2021-01-05\n";
  if (command === "ingest-meeting") return intro + "Usage: civicclerk-consume ingest-meeting --event-id ID --output DIRECTORY [--max-bytes N] [--max-documents N] [--file-types 1,2,4,5]\nUse an approved absolute private archive. Defaults: 12 MiB, 100 documents, PDF types 1,2,4,5. JSON result.\nExample: ingest-meeting --event-id 59 --output /approved/private/archive\n";
  return intro + usage + "\nCommands: list-meetings, ingest-meeting\nUse help COMMAND or COMMAND -h/--help. --version prints the initial package version.\nExample: civicclerk-consume list-meetings --from 2021-01-05 --to 2021-01-05\nOptions accept equals or split values on either side of a command; singleton options cannot repeat. -- ends option parsing. No prompts or stdin input.\n";
}

const usage = "Usage: list-meetings --from YYYY-MM-DD --to YYYY-MM-DD [--max-pages N] [--checkpoint NEW.json [--resume PRIOR.json]] | ingest-meeting --event-id ID --output DIRECTORY [--max-bytes N] [--max-documents N] [--file-types 1,2,4,5]";
export function httpSetting(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`invalid option ${name}`);
  return Number(value);
}
function makeClient(): CivicClerkClient {
  return new CivicClerkClient(new PoliteHttpClient({
    maxRetries: httpSetting("HTTP_MAX_RETRIES"),
    timeoutMs: httpSetting("HTTP_TIMEOUT_MS"),
    minIntervalMs: httpSetting("HTTP_MIN_INTERVAL_MS"),
    userAgent: process.env.HTTP_USER_AGENT,
  }), process.env.CIVICCLERK_API_BASE);
}
function dateRange(from: string, to: string): void {
  calendarDate(from); calendarDate(to);
  if (from > to) throw new Error("reversed date range");
}
function eventId(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("invalid event ID");
  return Number(value);
}
function requireOptions(values: Record<string, string | undefined>, required: string[], optional: string[] = []): void {
  if (required.some(key => !values[key]) || Object.keys(values).some(key => ![...required, ...optional].includes(key))) throw new Error(usage);
}
function limit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("invalid work limit");
  return Number(value);
}
function fileTypes(value: string | undefined): number[] | undefined {
  if (value === undefined) return undefined;
  if (!/^[1245](,[1245])*$/.test(value)) throw new Error("unsupported file types: supported PDF classes are 1,2,4,5");
  return [...new Set(value.split(",").map(Number))];
}
type CliClient = Pick<CivicClerkClient,"listEvents" | "downloadEvent"> & Partial<Pick<CivicClerkClient,"listEventsPage" | "validateListing">>;
async function persistListing(checkpoint: string, prior: Awaited<ReturnType<typeof readCheckpoint>>, api: CliClient, range: {from:string;to:string;maxPages?:number}, write:(line:string)=>void): Promise<void> {
  api.validateListing?.(range.from,range.to,prior?.continuation);
  // Reserve a new output before transport; never clobber an earlier batch.
  const handle=await open(checkpoint,"wx",0o600);
  try {
    if (!api.listEventsPage) throw new Error("paged client unavailable");
    const result=await api.listEventsPage(range.from,range.to,{maxPages:range.maxPages,continuation:prior?.continuation});
    const json=JSON.stringify(result);
    await handle.writeFile(json+"\n"); await handle.sync(); write(json);
  } finally {await handle.close();}
}
function checkpointObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function readCheckpoint(path: string | undefined) {
  if (path === undefined) return undefined;
  const prior=JSON.parse(await readFile(path,"utf8"));
  if (!checkpointObject(prior) || prior.complete !== false || !checkpointObject(prior.continuation)) throw new Error("invalid or completed checkpoint");
  return prior as {continuation: import("./client").ListingContinuation};
}
function listingClient(from: string, to: string, saved?: import("./client").ListingContinuation): CivicClerkClient {
  // Reuse the listing validator without constructing the real HTTP transport.
  const unavailable = async (): Promise<never> => { throw new Error("validation cannot perform HTTP"); };
  new CivicClerkClient({getJson:unavailable,request:unavailable},process.env.CIVICCLERK_API_BASE).validateListing(from,to,saved);
  return makeClient();
}
async function listCommand(values: Record<string,string|undefined>, client: CliClient | undefined, write:(line:string)=>void): Promise<void> {
    requireOptions(values, ["from", "to"], ["max-pages", "checkpoint", "resume"]);
    const from = values.from ?? "", to = values.to ?? "";
    dateRange(from, to);
    const maxPages = limit(values["max-pages"]);
    if (maxPages === 0) throw new Error("invalid page budget");
    if (values.resume && !values.checkpoint) throw new Error("resume requires a new checkpoint output");
    const prior = await readCheckpoint(values.resume);
    const api = client ?? listingClient(from,to,prior?.continuation);
    if (values.checkpoint) {
      await persistListing(values.checkpoint,prior,api,{from,to,maxPages},write);
    } else {
      write(JSON.stringify(await api.listEvents(from, to, { maxPages })));
    }
}
export async function runCli(args: string[], client?: Pick<CivicClerkClient, "listEvents" | "downloadEvent"> & Partial<Pick<CivicClerkClient, "listEventsPage">>, write: (line: string) => void = console.log): Promise<void> {
  const { positionals, values: parsed, tokens } = parseArgs({ args, tokens:true, allowPositionals: true, strict: true, options: {
    help: { type: "boolean", short: "h" }, version: { type: "boolean" },
    from: { type: "string" }, to: { type: "string" }, "event-id": { type: "string" }, output: { type: "string" },
    "max-bytes": { type: "string" }, "max-documents": { type: "string" }, "file-types": { type: "string" },
    "max-pages": { type: "string" }, checkpoint: { type: "string" }, resume: { type: "string" },
  } });
  const { help: helpRequested, version: versionRequested, ...values } = parsed;
  const boundary = tokens.find(token => token.kind === "option-terminator")?.index ?? Infinity;
  if (tokens.some(token => token.kind === "positional" && token.index > boundary)) throw new Error(usage);
  const helpCommand = tokens.find(token => token.kind === "positional" && token.index < boundary && token.value === "help");
  if (helpCommand && positionals[0] === "help") {
    if (positionals.length > 2 || (positionals[1] && !["list-meetings", "ingest-meeting"].includes(positionals[1]))) throw new Error(usage);
    write(help(positionals[1])); return;
  }
  if (helpRequested) { write(help(positionals[0])); return; }
  if (versionRequested) { write(`civicclerk-consume ${version}`); return; }
  const seen = new Set<string>();
  for (const token of tokens) if (token.kind === "option") { if (seen.has(token.name)) throw new Error(`duplicate option ${token.name}`); seen.add(token.name); }
  if (positionals.length !== 1) throw new Error(usage);
  if (positionals[0] === "list-meetings") {
    await listCommand(values,client,write);
  } else if (positionals[0] === "ingest-meeting") {
    requireOptions(values, ["event-id", "output"], ["max-bytes", "max-documents", "file-types"]);
    const id = eventId(values["event-id"]);
    const options = { maxBytes: limit(values["max-bytes"]), maxDocuments: limit(values["max-documents"]), fileTypes: fileTypes(values["file-types"]) };
    write(JSON.stringify(await (client ?? makeClient()).downloadEvent(id, values.output ?? "", options)));
  } else throw new Error(usage);
}
if (import.meta.main) {
  const output = new CheckedOutput();
  runCli(process.argv.slice(2), undefined, output.line).then(() => output.flush()).catch(error => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}
