#!/usr/bin/env bun
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { writeSync } from "node:fs";
import { writeStdout } from "../../arcgis-consume/src/cli-output";
import * as operations from "./collector";
import { ensure } from "./source";
type Frontend = {
  operations: typeof operations;
  stdout: (text: string) => Promise<void>;
  stderr: (text: string) => void;
};
type State = { info: string; diagnostic: string; result?: unknown };
function integer(value: string) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new InvalidArgumentError("expected a positive safe integer");
  return Number(value);
}
function offset(value: string) {
  if (value === "0") return 0;
  return integer(value);
}
function common(command: Command) {
  const o = command.optsWithGlobals();
  ensure(
    typeof o.archive === "string" && o.archive.length > 0,
    "--archive requires an explicit private absolute directory",
  );
  return {
    root: o.archive,
    timeoutMs: o.timeoutMs,
    budget: {
      ...(o.maxRequests === undefined ? {} : { requests: o.maxRequests }),
      ...(o.responseBytes === undefined
        ? {}
        : { responseBytes: o.responseBytes }),
      ...(o.totalBytes === undefined ? {} : { totalBytes: o.totalBytes }),
    },
  };
}
function parser(state: State) {
  const p = new Command()
    .name("socrata-consume")
    .description(
      "Archive bounded Austin Socrata datasets with immutable originals and offline SQLite verification.",
    )
    .version("0.1.0")
    .option(
      "--archive <directory>",
      "private absolute archive directory (required for operations)",
    )
    .option("--json", "compact machine JSON; results only on stdout")
    .option(
      "--timeout-ms <milliseconds>",
      "request/body timeout (default 45000)",
      integer,
    )
    .option(
      "--max-requests <count>",
      "attempt ceiling per retained run (default 10000)",
      integer,
    )
    .option(
      "--response-bytes <bytes>",
      "decoded response byte ceiling (default 20000000)",
      integer,
    )
    .option(
      "--total-bytes <bytes>",
      "aggregate decoded body ceiling per run (default 2000000000)",
      integer,
    )
    .configureOutput({
      writeOut: (t) => {
        state.info += t;
      },
      writeErr: (t) => {
        state.diagnostic += t;
      },
      outputError: (t, write) =>
        write("socrata-consume: " + t.replace(/^error: /, "")),
    })
    .exitOverride()
    .showSuggestionAfterError(true)
    .showHelpAfterError("(use --help for usage)");
  p.addHelpText(
    "after",
    "\nExamples:\n  socrata-consume discover --query payments --limit 20 --archive <private-archive>\n  socrata-consume inspect 8c6z-qnmj --archive <private-archive>\n  socrata-consume collect --preset echeckbook --where \"fiscal_year = '2025'\" --max-rows 100000 --archive <private-archive>\n  socrata-consume verify --archive <private-archive>\n\nNo authentication or source writes. WHERE field names must come from inspect; examples are not inferred schema. Collection is complete-or-error for the selected expression, never a silently complete prefix. Reuse is offline; --refresh retains a new version; --resume continues exact frozen selection/ceilings. Originals are fetch-decoded response bytes, not compressed wire captures.",
  );
  return p;
}
function discovery(p: Command, state: State, ops: typeof operations) {
  p.command("discover")
    .description("Search one explicitly bounded Austin catalog page.")
    .requiredOption("--query <text>", "catalog search terms")
    .requiredOption("--limit <count>", "maximum catalog rows", integer)
    .option("--offset <count>", "catalog start offset", offset, 0)
    .action(async (_options, command: Command) => {
      const o = command.opts();
      state.result = await ops.discover({
        ...common(command),
        query: o.query,
        limit: o.limit,
        offset: o.offset,
      });
    });
  p.command("inspect")
    .description("Retain catalog membership and tabular field schema.")
    .argument("<asset>", "exact asset ID")
    .action(async (asset: string, _options, command: Command) => {
      state.result = await ops.inspect({ ...common(command), asset });
    });
}
function collection(p: Command, state: State, ops: typeof operations) {
  p.command("collect")
    .description(
      "Collect full bounded asset or WHERE selection; count above ceiling fails before pages.",
    )
    .argument("[asset]", "exact catalog asset ID")
    .option("--preset <name>", "named preset: echeckbook")
    .requiredOption(
      "--max-rows <count>",
      "explicit selected-row safety ceiling",
      integer,
    )
    .option(
      "--page-size <count>",
      "requested rows per page (default 10000)",
      integer,
    )
    .option("--where <expression>", "exact retained SoQL WHERE expression")
    .option("--resume", "continue exact verified partial selection")
    .option(
      "--refresh",
      "retain new version; never overrides unknown transfers",
    )
    .action(async (asset: string | undefined, _options, command: Command) => {
      const o = command.opts();
      state.result = await ops.collect({
        ...common(command),
        asset,
        preset: o.preset,
        maxRows: o.maxRows,
        pageSize: o.pageSize,
        where: o.where,
        resume: o.resume,
        refresh: o.refresh,
      });
    });
}
function offline(p: Command, state: State, ops: typeof operations) {
  for (const name of ["status", "verify"] as const)
    p.command(name)
      .description(
        "Offline verified original/timing/SQLite/row provenance inspection.",
      )
      .action(async (_options, command: Command) => {
        state.result = await ops[name](common(command).root);
      });
}
function diagnostic(error: unknown) {
  const code =
    error instanceof Error && "code" in error ? String(error.code) : undefined;
  if (code && /^[A-Z0-9_]+$/.test(code))
    return `operation failed (${code}); retained partials are preserved`;
  return error instanceof Error ? error.message : "operation failed";
}
function render(p: Command, state: State) {
  if (state.result === undefined) return state.info;
  return (
    state.info +
    JSON.stringify(state.result, null, p.opts().json ? undefined : 2) +
    "\n"
  );
}
export async function main(
  args: string[],
  dependencies: Partial<Frontend> = {},
) {
  const io = {
    operations,
    stdout: writeStdout,
    stderr: (text: string) => {
      writeSync(2, text);
    },
    ...dependencies,
  };
  const state: State = { info: "", diagnostic: "" },
    p = parser(state);
  discovery(p, state, io.operations);
  collection(p, state, io.operations);
  offline(p, state, io.operations);
  try {
    if (args.length === 0) p.outputHelp();
    else await p.parseAsync(args, { from: "user" });
    await io.stdout(render(p, state));
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      try {
        await io.stdout(state.info);
        return 0;
      } catch (delivery) {
        io.stderr(`socrata-consume: ${diagnostic(delivery)}\n`);
        return 1;
      }
    }
    io.stderr(state.diagnostic || `socrata-consume: ${diagnostic(error)}\n`);
    return 1;
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
