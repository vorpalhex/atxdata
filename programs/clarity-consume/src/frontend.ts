import { Command } from "commander";
import { version } from "../package.json";
export const commands = [
  "list",
  "discover",
  "collect",
  "sync",
  "status",
  "verify",
];
export const cliOptions = {
  archive: { type: "string" as const },
  election: { type: "string" as const },
  date: { type: "string" as const },
  refresh: { type: "boolean" as const, default: false },
};
export function createCommand(onCommand: (name: string) => void = () => {}) {
  const command = new Command()
    .name("clarity-consume")
    .description("Clarity selected-election collector")
    .helpOption(false)
    .addHelpCommand(false)
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} });
  for (const [name, definition] of Object.entries(cliOptions))
    command.option(
      `--${name}${definition.type === "string" ? " <value>" : ""}`,
      name,
    );
  command
    .option("-h, --help", "show offline help")
    .option("--version", "show package version");
  for (const name of commands)
    command
      .command(name)
      .description(
        name === "collect" || name === "sync"
          ? "Collect one selected election"
          : name === "list" || name === "discover"
            ? "List bounded catalog election IDs"
            : "Check local archive without HTTP",
      )
      .allowExcessArguments(false)
      .action(() => onCommand(name));
  command.addHelpText("after", details());
  return command;
}
// Commander consumes values. This guard only preserves node:util's strict
// option-like-value rejection and the contextual informational terminator.
function context(args: string[], command: Command, strict = false) {
  let end = args.length;
  let incomplete = false;
  const booleans: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      end = i;
      break;
    }
    // Loose legacy information recognizes -h anywhere in a short flag group.
    if (
      !strict &&
      arg.startsWith("-") &&
      !arg.startsWith("--") &&
      arg.includes("h")
    )
      booleans.help = true;
    const key = arg.split("=", 1)[0]!;
    const option = command.options.find(
      (option) => option.long === key || option.short === key,
    );
    if (option?.required && !arg.includes("=")) {
      const value = args[++i];
      incomplete = value === undefined;
      if (
        strict &&
        (value === undefined || (value.startsWith("-") && value !== "-"))
      )
        throw new Error("Usage: missing or ambiguous option value");
    } else if (option && !option.required) {
      booleans[option.attributeName()] =
        arg.startsWith("--") && arg.includes("=")
          ? arg.slice(arg.indexOf("=") + 1)
          : true;
    }
  }
  return { end, booleans, incomplete };
}
function inspect(args: string[]) {
  const command = createCommand(),
    { end, booleans, incomplete } = context(args, command);
  const parsed = command.parseOptions([
    ...args.slice(0, end),
    ...(incomplete ? [""] : []),
  ]);
  return {
    values: { ...command.opts(), ...booleans },
    words: [...parsed.operands, ...parsed.unknown].filter(
      (word) => word === "-" || !word.startsWith("-"),
    ),
  };
}
export function parseCommand(args: string[]) {
  let selected: string | undefined;
  const command = createCommand((name) => {
    selected = name;
  });
  context(args, command, true);
  try {
    command.parse(args, { from: "user" });
  } catch {
    throw new Error(
      "Usage: invalid command or options; use clarity-consume --help",
    );
  }
  return {
    command: selected,
    values: Object.assign({ refresh: false }, command.opts()) as {
      archive?: string;
      election?: string;
      date?: string;
      refresh: boolean;
    },
  };
}
export function information(args: string[]): string | undefined {
  const { values, words } = inspect(args);
  if (values.version === true) return `clarity-consume ${version}`;
  if (values.help !== true && words[0] !== "help") return;
  const command = words[0] === "help" ? words[1] : words[0];
  if (command && !commands.includes(command))
    throw new Error("Unknown command; use clarity-consume --help");
  return help(command);
}
export function help(name?: string) {
  const command = createCommand();
  return name
    ? command.commands
        .find((child) => child.name() === name)!
        .helpInformation() + details(name)
    : command.helpInformation() + details();
}
function details(command?: string) {
  return `Clarity selected-election collector${command ? `: ${command}` : ""}\nUsage: bun src/cli.ts ${command ?? commands.join("|")} --archive ABSOLUTE_PRIVATE_DIRECTORY [options]\n\nlist/discover: bounded catalog and election IDs, not complete history.\ncollect/sync: exactly one --election DIGITS or --date YYYY-MM-DD; optional --refresh.\nstatus/verify: local archive checks, no HTTP.\nIDs are literal strings: leading zeroes are preserved. Archives must be private canonical directories outside checkouts.\nExamples:\n  bun src/cli.ts list --archive "$ARCHIVE"\n  bun src/cli.ts collect --archive "$ARCHIVE" --election 009876\n  bun src/cli.ts collect --archive "$ARCHIVE" --date 2026-11-03\nOptions accept --name=value or --name value, before/after command; repeats use last value.\n-h, --help, help COMMAND and --version need no archive. -- ends options; subsequent operands are not help.\nResults: pretty JSON. Exit 0 success; 1 failure. Plain invocation retains exit 1. No prompts, color or pager.\n`;
}
