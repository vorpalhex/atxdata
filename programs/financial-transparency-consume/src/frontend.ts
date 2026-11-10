import { Command } from "commander";
import { version } from "../package.json";
export const sourceCommands = [
  "discover",
  "collect",
  "acquire",
  "sync",
  "verify-source",
];
const commands = ["import", "status", "verify", ...sourceCommands];
export const importOptions = [
  "file",
  "output",
  "fiscal-year",
  "max-bytes",
  "max-rows",
];
export const sourceOptions = [
  "source-archive",
  "output",
  "fiscal-year",
  "first-year",
  "last-year",
  "max-requests",
  "max-bytes",
  "max-total-bytes",
  "max-rows",
  "refresh",
];
const strings = [...new Set([...importOptions, ...sourceOptions])].filter(
  (name) => name !== "refresh",
);
export function createCommand(onCommand: (name: string) => void = () => {}) {
  const command = new Command()
    .name("financial-transparency-consume")
    .description("Fiscal-year CSV importer and acquisition companion")
    .helpOption(false)
    .addHelpCommand(false)
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} });
  for (const name of strings) command.option(`--${name} <value>`, name);
  command
    .option("--refresh", "request a new snapshot")
    .option("-h, --help", "show offline help")
    .option("--version", "show package version");
  for (const name of commands)
    command
      .command(name)
      .description(
        name === "import"
          ? "Import a local fiscal-year CSV"
          : name === "discover"
            ? "Discover explicitly bounded fiscal years"
            : ["collect", "acquire", "sync"].includes(name)
              ? "Collect one selected fiscal year"
              : "Verify local archives without HTTP",
      )
      .allowExcessArguments(false)
      .action(() => onCommand(name));
  command.addHelpText("after", details());
  return command;
}
// Preserve legacy strict option-like-value rejection, boolean equals semantics,
// and contextual terminators, without interpreting option values ourselves.
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
        throw new Error("usage");
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
export function commandOf(args: string[]) {
  return inspect(args).words[0];
}
export function parseCommand(args: string[], allowed: string[]) {
  let selected: string | undefined;
  const command = createCommand((name) => {
    selected = name;
  });
  context(args, command, true);
  const names: string[] = [];
  for (const option of command.options)
    command.on(`option:${option.name()}`, () => {
      const name = option.name();
      if (names.includes(name) || !allowed.includes(name))
        throw new Error("duplicate or unsupported option");
      names.push(name);
    });
  command.parse(args, { from: "user" });
  if (!selected || commandOf(args) !== selected) throw new Error("usage");
  const values: Record<string, string | boolean | undefined> = {};
  for (const option of command.options) {
    const value = command.opts()[option.attributeName()];
    if (value !== undefined) values[option.name()] = value;
  }
  return { command: selected, values, names };
}
export function information(args: string[]): string | undefined {
  const { values, words } = inspect(args);
  if (values.version === true)
    return `financial-transparency-consume ${version}`;
  if (values.help !== true && words[0] !== "help") return;
  const command = words[0] === "help" ? words[1] : words[0];
  if (command && !commands.includes(command)) throw new Error("usage");
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
  return `Fiscal-year CSV importer and acquisition companion${command ? `: ${command}` : ""}.\nUsage: bun src/cli.ts ${command ?? commands.join("|")} [options]\nimport --file CSV --fiscal-year YEAR --output PRIVATE_ARCHIVE [--max-bytes N] [--max-rows N]\nverify/status --output PRIVATE_ARCHIVE\ndiscover --source-archive PRIVATE_SOURCE (--fiscal-year YEAR | --first-year YEAR --last-year YEAR) [budgets] [--refresh]\ncollect/acquire/sync --source-archive PRIVATE_SOURCE --output PRIVATE_IMPORT --fiscal-year YEAR [budgets] [--refresh]\nverify-source --source-archive PRIVATE_SOURCE --output PRIVATE_IMPORT\nBudgets: --max-requests 10, --max-bytes 104857600, --max-total-bytes 209715200, --max-rows 1000000. Positive safe decimal integers, no leading zeroes.\nExamples:\n  bun src/cli.ts import --file "$CSV" --fiscal-year 2032 --output "$ARCHIVE"\n  bun src/cli.ts discover --source-archive "$SOURCE" --fiscal-year 2032\nUse private canonical directories outside checkouts. Source archive and import output are separate. Browser download is separate optional input. seed is unsupported.\nOptions accept equals/split values before/after commands, within documented command scopes; duplicate options fail. -- ends options; subsequent operands are not command/help selectors.\n-h, --help, help COMMAND, --version are offline. Plain invocation retains fixed failure/status 1 with guidance.\nImport/reuse exits 0 clean, 2 partial; collect also 3 unavailable, 4 unsupported. Verify/status/source verification 0 success, 1 failure. Results are JSON, failures stay {"error":"operation_failed"}. No census/history completeness claim.\nDiscovery is caller-bounded HEAD candidates, not content validation. Default verified reuse and verify-source make zero HTTP requests. Refresh requests a new snapshot. Retries=0; redirects=0; spacing>=3 seconds plus stricter policy/cooldown. No prompts, color or pager.\n`;
}
export function guidance(diagnose: (text: string) => void = console.error) {
  diagnose(
    "financial-transparency-consume: operation failed. Check command, required options, positive decimal limits and private archive permissions; use --help or help COMMAND. No private error details are printed.",
  );
}
