#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { CivicClerkClient, calendarDate } from "./client";
import { PoliteHttpClient } from "./http";

const usage = "Usage: list-meetings --from YYYY-MM-DD --to YYYY-MM-DD | ingest-meeting --event-id ID --output DIRECTORY";
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
function requireOptions(values: Record<string, string | undefined>, required: string[]): void {
  if (required.some(key => !values[key]) || Object.keys(values).some(key => !required.includes(key))) throw new Error(usage);
}
export async function runCli(args: string[], client?: Pick<CivicClerkClient, "listEvents" | "downloadEvent">, write: (line: string) => void = console.log): Promise<void> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    from: { type: "string" }, to: { type: "string" }, "event-id": { type: "string" }, output: { type: "string" },
  } });
  if (positionals.length !== 1) throw new Error(usage);
  if (positionals[0] === "list-meetings") {
    requireOptions(values, ["from", "to"]);
    const from = values.from ?? "", to = values.to ?? "";
    dateRange(from, to);
    write(JSON.stringify(await (client ?? makeClient()).listEvents(from, to)));
  } else if (positionals[0] === "ingest-meeting") {
    requireOptions(values, ["event-id", "output"]);
    const id = eventId(values["event-id"]);
    write(JSON.stringify(await (client ?? makeClient()).downloadEvent(id, values.output ?? "")));
  } else throw new Error(usage);
}
if (import.meta.main) {
  runCli(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
