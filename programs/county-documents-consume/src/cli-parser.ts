import { Command } from "commander";

type Failure = { index: number; message: string };

// Commander consumes and stores options. These guards retain only the legacy
// contracts which differ from its defaults: first/duplicate errors, split
// option-like values, boolean equals, informational precedence and -- scope.
export function parseCLI(program: Command, args: string[]) {
  const failures: Failure[] = [];
  const seen = new Set<string>();
  const words: number[] = [];
  const normalized: string[] = [];
  let info: string | undefined;
  let infoIndex = -1;
  const fail = (index: number, message: string) =>
    failures.push({ index, message });
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token === "--") {
      if (i + 1 < args.length) fail(i + 1, "unexpected operand; see --help");
      break;
    }
    if (["-h", "--help", "--version"].includes(token)) {
      info = token === "--version" ? "version" : "help";
      infoIndex = i;
      normalized.push(token);
      continue;
    }
    const key = token.split("=", 1)[0]!;
    const option = program.options.find((candidate) => candidate.long === key);
    if (!option || ["--help", "--version"].includes(key)) {
      if (token.startsWith("--")) fail(i, "unknown option; see --help");
      else words.push(i);
      // Only exact -h is informational; legacy short-looking words are
      // operands, not Commander short-option groups. Shield them until parsed.
      normalized.push(
        token.startsWith("-") && !token.startsWith("--") ? "\0" + token : token,
      );
      continue;
    }
    if (seen.has(key)) fail(i, "duplicate option; see --help");
    seen.add(key);
    const equal = token.indexOf("=");
    if (!option.required) {
      if (equal >= 0) fail(i, "boolean switches do not take values");
      normalized.push(key);
      continue;
    }
    const index = i;
    const value = equal < 0 ? args[++i] : token.slice(equal + 1);
    if (!value || (equal < 0 && value.startsWith("--")))
      fail(index, "missing " + key + " value; see --help");
    // Equals preserves literal short-option-looking values and lets Commander
    // finish parsing so later explicit help can bypass unrelated failures.
    normalized.push(`${key}=${value ?? ""}`);
  }
  const parsed = program.parseOptions(normalized);
  const operands = [
    ...parsed.operands,
    ...parsed.unknown.filter((token) => !token.startsWith("--")),
  ].map((token) => token.replace(/^\0/, ""));
  const helpCommand = operands[0] === "help";
  if (helpCommand && words[0]! > infoIndex) info = "help";
  const command = operands[helpCommand ? 1 : 0];
  if (
    command &&
    !program.commands.some((candidate) => candidate.name() === command)
  )
    throw Error("unknown command; see --help");
  const extraIndex = helpCommand ? 2 : 1;
  if (operands.length > extraIndex)
    fail(words[extraIndex]!, "unexpected operand; see --help");
  if (!info && failures.length)
    throw Error(failures.sort((a, b) => a.index - b.index)[0]!.message);
  const options = program.opts();
  const flags: Record<string, string> = {};
  for (const option of program.options) {
    if (["help", "version"].includes(option.name())) continue;
    const value = options[option.attributeName()];
    if (program.getOptionValueSource(option.attributeName()) === "cli")
      flags[option.long!] = value === true ? "yes" : value;
  }
  return { command, flags, info };
}
