import { parseArgs } from "node:util";
import { importCsv } from "./importer";
import { verifyArchive } from "./verify";
import { positiveInteger } from "./model";
function integer(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error("invalid_integer");
  return positiveInteger(Number(value));
}
type Values = Partial<
  Record<"file" | "output" | "fiscal-year" | "max-bytes" | "max-rows", string>
>;
function importCommand(
  values: Values,
  output: string,
): { result: object; exit: number } {
  if (!values.file || !values["fiscal-year"]) throw new Error("usage");
  const batch = importCsv({
    file: values.file,
    output,
    fiscalYear: integer(values["fiscal-year"]),
    maxBytes: integer(values["max-bytes"] ?? "104857600"),
    maxRows: integer(values["max-rows"] ?? "1000000"),
  });
  const {
    fileSHA256,
    fiscalYear,
    bytes,
    status,
    rowsRead,
    accepted,
    rejected,
    reused,
  } = batch;
  return {
    result: {
      fileSHA256,
      fiscalYear,
      bytes,
      status,
      rowsRead,
      accepted,
      rejected,
      reused,
    },
    exit: rejected ? 2 : 0,
  };
}
function execute(args: string[]): { result: object; exit: number } {
  const { positionals, values, tokens } = parseArgs({
    args,
    tokens: true,
    allowPositionals: true,
    strict: true,
    options: {
      file: { type: "string" },
      output: { type: "string" },
      "fiscal-year": { type: "string" },
      "max-bytes": { type: "string" },
      "max-rows": { type: "string" },
    },
  });
  const names = tokens
    .filter((token) => token.kind === "option")
    .map((token) => token.name);
  if (new Set(names).size !== names.length) throw new Error("duplicate_option");
  if (positionals.length !== 1 || !values.output) throw new Error("usage");
  if (positionals[0] === "import") return importCommand(values, values.output);
  if (
    !["verify", "status"].includes(positionals[0]) ||
    Object.keys(values).some((key) => key !== "output")
  )
    throw new Error("usage");
  return { result: verifyArchive(values.output), exit: 0 };
}
export function runCli(
  args: string[],
  write: (text: string) => void = console.log,
): number {
  if (args.length === 1 && args[0] === "--help") {
    write(
      "Offline fiscal-year CSV importer. Browser download is separate.\nimport --file CSV --fiscal-year YEAR --output PRIVATE_ARCHIVE [--max-bytes N] [--max-rows N]\nverify --output PRIVATE_ARCHIVE\nstatus --output PRIVATE_ARCHIVE\nImport exits: 0 clean/reused clean; 2 imported_with_rejections (also reused); 1 failure. Verify/status: 0 locally verified, 1 failure. No financial census completeness claim. seed/collect are unsupported.",
    );
    return 0;
  }
  try {
    const { result, exit } = execute(args);
    write(JSON.stringify(result));
    return exit;
  } catch {
    write(JSON.stringify({ error: "operation_failed" }));
    return 1;
  }
}
if (import.meta.main) process.exitCode = runCli(process.argv.slice(2));
