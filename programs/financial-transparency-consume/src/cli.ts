import { runAcquisitionCli } from "./acquisition-cli";
import { information, guidance, help, commandOf, sourceCommands } from "./frontend";
import { writeOutput, OutputFailure, outputStatus } from "./output";
import { parseArgs } from "node:util";
import { importCsv } from "./importer";
import { verifyArchive } from "./verify";
import { decimalInteger as integer } from "./model";
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
  if (positionals.length !== 1 || !values.output || commandOf(args)!==positionals[0]) throw new Error("usage");
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
  diagnose: (text: string) => void = console.error,
): number {
  let text: string, exit: number;
  try {
    const info = information(args);
    if (info !== undefined) { text=info; exit=0; }
    else { const outcome=execute(args); text=JSON.stringify(outcome.result); exit=outcome.exit; }
  } catch {
    if (!args.length) diagnose(help());
    guidance(diagnose);
    text=JSON.stringify({ error: "operation_failed" }); exit=1;
  }
  write(text);
  return exit;
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  let command: string | undefined;
  try { command=commandOf(args); } catch { /* normal parser renders safe failure */ }
  let rendered='';
  const capture=(text:string)=>{rendered=text;};
  const exit = sourceCommands.includes(command ?? '')
    ? await runAcquisitionCli(args,capture)
    : runCli(args,capture);
  try { await writeOutput(rendered); process.exitCode=exit; }
  catch(error){
    if(error instanceof OutputFailure){process.exitCode=outputStatus(error,exit);if(error.timedOut)process.exit(1);}
    else {console.error('financial-transparency-consume: output delivery failed.');process.exitCode=1;}
  }
}
