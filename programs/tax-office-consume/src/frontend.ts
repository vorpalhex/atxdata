import { write } from "node:fs";
import { Command as CommanderCommand, Option } from "commander";
import metadata from "../package.json";

type Command = {
  usage: string;
  description: string;
  options: string[];
  flags?: string[];
  notes?: string;
};
export type Commands = Record<string, Command>;
const name = metadata.name;
export function tokenLabel(token: string) {
  return /^-{0,2}[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(token)
    ? JSON.stringify(token)
    : "[invalid token; consult help]";
}
export function usage(command?: string) {
  return `Usage: ${name} ${command ?? "COMMAND"} [OPTIONS]\nTry '${name} ${command ? "help " + command : "--help"}' for options and examples.`;
}
function commandSpec(commands: Commands, command?: string) {
  return command && Object.hasOwn(commands, command)
    ? commands[command]
    : undefined;
}
// Fresh independent Commander trees keep help/metadata reusable without startup.
export function createProgram(commands: Commands) {
  const program = new CommanderCommand(name)
    .description("Discover and retain Tax Office exports")
    .usage("COMMAND [OPTIONS]")
    .enablePositionalOptions()
    .version(`${name} ${metadata.version}`);
  program
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .exitOverride();
  for (const [key, spec] of Object.entries(commands)) {
    const child = program
      .command(key)
      .description(spec.description)
      .usage(spec.usage || "[OPTIONS]")
      .addHelpCommand(false);
    for (const key of spec.options)
      child.addOption(
        new Option(key + (spec.flags?.includes(key) ? "" : " <VALUE>")),
      );
    if (spec.notes) child.addHelpText("after", "\n" + spec.notes);
  }
  return program;
}
// The registered tree selects the operational handler. Option validation stays in
// that handler so duplicate/value/first-error compatibility is unchanged.
export async function dispatchCommand<T>(
  args: string[],
  commands: Commands,
  handler: (command: string, rest: string[]) => Promise<T>,
): Promise<T> {
  const program = createProgram(commands).addHelpCommand(false);
  let result: T;
  for (const child of program.commands)
    child.action(async () => {
      result = await handler(child.name(), args.slice(1));
    });
  // Command-first is part of the public contract. Help/version are handled by
  // information(), not by operational run(). Never parse values as commands.
  if (!args.length) throw new Error("command required; try --help");
  if (args[0]!.startsWith("-"))
    throw new Error(`unknown command ${tokenLabel(args[0]!)}; try --help`);
  try {
    await program.parseAsync(args.slice(0, 1), { from: "user" });
  } catch (error) {
    if ((error as { code?: string }).code === "commander.unknownCommand")
      throw new Error(`unknown command ${tokenLabel(args[0]!)}; try --help`);
    throw error;
  }
  return result!;
}
export function help(commands: Commands, examples: string, command?: string) {
  const spec = commandSpec(commands, command);
  if (command && !spec)
    throw new Error(`unknown help command ${tokenLabel(command)}; try --help`);
  const program = createProgram(commands);
  const target = command
    ? program.commands.find((child) => child.name() === command)!
    : program;
  return (
    target.helpInformation() +
    (spec?.notes ? "\n" + spec.notes + "\n" : "") +
    `\n\n  -h, --help       Show this help without opening state\n  help COMMAND     Show command-local help\n  --version        Program version (top-level only)\n\nExamples (operator-supplied canonical paths):\n${examples}\n\nOptions follow the command; --key=value and --key value are equivalent.\nRepeated options and abbreviations are rejected. -- ends options; no file operands are accepted.\nResults are one JSON document plus newline on stdout; errors go to stderr (status 1).\nInputs are retained canonical regular files; --output is a private archive root, not stdout.\nSee this program's README for bounds, retained inputs, safety and recovery.\n`
  );
}
function topInformation(
  command: string | undefined,
  rest: string[],
  commands: Commands,
  examples: string,
) {
  if (command === "--version") return `${name} ${metadata.version}\n`;
  if (command === "--help" || command === "-h") return help(commands, examples);
  if (command === "help") {
    if (rest.length > 1)
      throw new Error("help accepts one command; try --help");
    return help(commands, examples, rest[0]);
  }
}
// Walk only option positions; required values may themselves spell --help.
function commandHelpRequested(rest: string[], spec: Command) {
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token === "--") break;
    if (token === "--help" || token === "-h") return true;
    if (
      !token.includes("=") &&
      spec.options.includes(token) &&
      !spec.flags?.includes(token)
    )
      i++;
  }
  return false;
}
export function information(
  args: string[],
  commands: Commands,
  examples: string,
) {
  const [command, ...rest] = args;
  const top = topInformation(command, rest, commands, examples);
  if (top !== undefined) return top;
  const spec = commandSpec(commands, command);
  if (!spec) return;
  if (commandHelpRequested(rest, spec))
    return help(commands, examples, command);
}
function missingValue(key: string) {
  return new Error(
    `${key} requires a nonempty value; use ${key}=VALUE or ${key} VALUE`,
  );
}
// Commander owns token consumption. These hooks retain strict duplicates and
// legacy value rules rather than its last-value-wins defaults.
export function createOptions(
  allowed: string[],
  required: string[],
  flags: string[] = [],
  argv: string[] = [],
) {
  const command = new CommanderCommand(name)
    .helpOption(false)
    .addHelpCommand(false)
    .allowExcessArguments(false)
    // Stop at the first unknown/operand, rather than processing later callbacks.
    .passThroughOptions();
  command
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .exitOverride()
    .showSuggestionAfterError(false);
  const seen = new Set<string>();
  for (const key of allowed) {
    const flag = flags.includes(key);
    const option = new Option(
      key + (flag ? "" : " <VALUE>"),
    ).makeOptionMandatory(required.includes(key));
    if (!flag)
      option.argParser((raw: string) => {
        if (seen.has(key))
          throw new Error(`repeated option ${key}; supply it once`);
        // Only an equals-attached value may begin with --; -h remains a value.
        if (
          !raw ||
          (raw.startsWith("--") &&
            !argv
              .find((token) => token === key || token.startsWith(key + "="))
              ?.startsWith(key + "="))
        )
          throw missingValue(key);
        return raw;
      });
    command.addOption(option);
    command.on("option:" + option.name(), () => {
      if (seen.has(key))
        throw new Error(`repeated option ${key}; supply it once`);
      seen.add(key);
    });
  }
  return command;
}
export function parseOptions(
  args: string[],
  allowed: string[],
  required: string[],
  flags: string[] = [],
) {
  const command = createOptions(allowed, required, flags, args);
  let parsed: ReturnType<CommanderCommand["parseOptions"]>;
  try {
    parsed = command.parseOptions(args);
  } catch (error) {
    if (
      (error as { code?: string }).code === "commander.optionMissingArgument"
    ) {
      const key = allowed.find((key) =>
        (error as Error).message.includes("'" + key + " <VALUE>'"),
      )!;
      if (
        command.getOptionValueSource(
          key.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
        )
      )
        throw new Error(`repeated option ${key}; supply it once`);
      throw missingValue(key);
    }
    throw error;
  }
  if (parsed.operands.length)
    throw new Error(
      args.indexOf("--") >= 0 &&
        parsed.operands.length === args.length - args.indexOf("--") - 1
        ? "unexpected operand after --; this command accepts named options only"
        : "unexpected operand; this command accepts named options only",
    );
  if (parsed.unknown.length) {
    const token = parsed.unknown[0]!,
      key = token.split("=")[0]!;
    if (flags.includes(key) && token.includes("=")) {
      const option = command.options.find((option) => option.long === key)!;
      if (command.getOptionValueSource(option.attributeName()))
        throw new Error(`repeated option ${key}; supply it once`);
      throw new Error(`${key} is a bare flag; omit it for false`);
    }
    throw new Error(
      `unknown option ${tokenLabel(key)}; use the exact name shown in help`,
    );
  }
  const values = new Map<string, string>();
  for (const [attribute, value] of Object.entries(command.opts())) {
    const option = command.options.find(
      (option) => option.attributeName() === attribute,
    )!;
    values.set(option.long!, value === true ? "true" : String(value));
  }
  for (const key of required)
    if (!values.has(key)) throw new Error(`required ${key}; see command help`);
  return values;
}

// Asynchronous descriptor writes keep the event loop free even for a blocking pipe.
// One monotonic deadline covers all partial writes/retries, not each chunk.
type Writer = { write: typeof write; now: () => number };
function stdoutTimeout() {
  return Object.assign(new Error("stdout deadline"), {
    code: "ETIMEDOUT",
    outputPending: true,
  });
}
async function writeAttempt(
  writer: Writer,
  data: Buffer,
  offset: number,
  expired: Promise<never>,
) {
  try {
    return await Promise.race([
      new Promise<number>((resolve, reject) => {
        writer.write(
          1,
          data,
          offset,
          Math.min(16384, data.length - offset),
          (error, written) => (error ? reject(error) : resolve(written)),
        );
      }),
      expired,
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
    await Promise.race([new Promise((r) => setTimeout(r, 1)), expired]);
  }
}
function outputFailure(cause: unknown) {
  const code = (cause as NodeJS.ErrnoException).code;
  return Object.assign(
    new Error(
      `stdout delivery failed${code ? " (" + code + ")" : ""}; completed archive work is retained`,
    ),
    {
      code,
      outputFailure: true,
      outputPending:
        (cause as { outputPending?: boolean }).outputPending === true,
    },
  );
}
export async function writeOutput(
  text: string,
  writer: Writer = { write, now: () => performance.now() },
) {
  const deadline = writer.now() + 10000,
    data = Buffer.from(text);
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(stdoutTimeout()),
      Math.max(0, deadline - writer.now()),
    );
  });
  try {
    while (offset < data.length) {
      if (writer.now() >= deadline) throw stdoutTimeout();
      const written = await writeAttempt(writer, data, offset, expired);
      if (written === undefined) continue;
      if (writer.now() >= deadline) throw stdoutTimeout();
      if (written === 0) throw new Error("stdout made no write progress");
      offset += written;
    }
  } catch (cause) {
    throw outputFailure(cause);
  } finally {
    clearTimeout(timer);
  }
}
// A timed-out OS write cannot be canceled portably. Domain work is already closed;
// terminate the native process rather than waiting forever for its writer thread.
export function nativeFailure(error: unknown) {
  failure(error);
  if ((error as { outputPending?: boolean })?.outputPending === true)
    process.exit(1);
}
export function failure(error: unknown) {
  if (
    (error as NodeJS.ErrnoException)?.code === "EPIPE" &&
    (error as { outputFailure?: boolean }).outputFailure === true
  )
    return;
  console.error(
    `${name}: ${error instanceof Error ? error.message : String(error)}\n${usage()}`,
  );
  process.exitCode = 1;
}
