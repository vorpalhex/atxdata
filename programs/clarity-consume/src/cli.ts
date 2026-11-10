import { parseCommand } from "./frontend";
import { Collector } from "./collector";
import { token, isoDate, dateSelectionDiagnostic } from "./source";
import { information, help } from "./frontend";
import { writeOutput, OutputFailure, outputStatus } from "./output";
function options(args: string[]) {
  const { command, values } = parseCommand(args);
  if (!command || !values.archive)
    throw new Error(
      "Usage: bun src/cli.ts list|discover|collect|sync|status|verify --archive ABSOLUTE_PRIVATE_DIRECTORY [--election DIGITS | --date YYYY-MM-DD] [--refresh]",
    );
  validateSelection(command, values);
  return {
    command,
    archive: values.archive,
    election: values.election,
    date: values.date,
    refresh: values.refresh,
  };
}
function validateSelection(
  command: string,
  values: { election?: string; date?: string; refresh: boolean },
) {
  const collecting = ["collect", "sync"].includes(command);
  if (
    collecting &&
    (values.election !== undefined) === (values.date !== undefined)
  )
    throw new Error(
      "collect/sync requires exactly one of --election or --date",
    );
  if (values.election !== undefined) token(values.election);
  if (values.date !== undefined) isoDate(values.date);
  if (
    !collecting &&
    (values.election !== undefined ||
      values.date !== undefined ||
      values.refresh)
  )
    throw new Error("election/date/refresh only supported by collect/sync");
}
export async function main(args: string[] = process.argv.slice(2)) {
  const input = options(args),
    collector = await Collector.open(input.archive);
  const collect = () =>
      input.date !== undefined
        ? collector.collectDate(input.date, input.refresh)
        : collector.collect(input.election!, input.refresh),
    list = () => collector.list();
  const commands: Record<string, () => Promise<unknown>> = {
    collect,
    sync: collect,
    list,
    discover: list,
    status: () => collector.status(),
    verify: () => collector.verify(),
  };
  try {
    return await commands[input.command]();
  } finally {
    await collector.close();
  }
}
if (import.meta.main) {
  try {
    const args = process.argv.slice(2),
      info = information(args);
    if (info !== undefined) await writeOutput(info);
    else if (!args.length) {
      console.error(help());
      process.exitCode = 1;
    } else await writeOutput(JSON.stringify(await main(args), null, 2));
  } catch (error) {
    if (error instanceof OutputFailure) {
      process.exitCode = outputStatus(error);
      if (error.timedOut) process.exit(1);
    } else {
      const selection = dateSelectionDiagnostic(error);
      console.error(
        selection === undefined
          ? "clarity-consume: operation failed; check selection and private archive. Use --help or help COMMAND."
          : `clarity-consume: ${selection}. Select an --election ID or use --refresh for a fresh catalog.`,
      );
      process.exitCode = 1;
    }
  }
}
