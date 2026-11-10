import { Store } from "./store";
import { SELECTION, ARCHIVE_HASH, selected } from "./source";
import {
  withZip,
  inventory,
  serialized,
  integrity,
  digest,
  LIMITS,
} from "./archive";
import { generalCommand, runGeneral, REQUIRED, OPTIONAL } from "./general-cli";
import {
  information,
  dispatchCommand,
  writeOutput,
  nativeFailure as failure,
  parseOptions,
  tokenLabel,
} from "./frontend";
import { commandHelp, EXAMPLES } from "./cli-help";
const OPTIONS: Record<string, string[]> = {
  list: [],
  import: ["--archive", "--layout", "--selection", "--rows", "--output"],
  inventory: ["--archive", "--selection"],
  integrity: ["--archive", "--selection", "--max-expanded", "--max-seconds"],
  status: ["--output"],
  verify: ["--output"],
};
function options(command: string, args: string[]) {
  const supported = Object.hasOwn(OPTIONS, command)
    ? OPTIONS[command]
    : undefined;
  if (!supported)
    throw new Error(`unknown command ${tokenLabel(command)}; try --help`);
  return parseOptions(args, supported, supported);
}
async function inspect(command: string, v: Map<string, string>) {
  selected(v.get("--selection")!, 25);
  const archive = v.get("--archive")!;
  if ((await digest(archive, LIMITS.compressed)) !== ARCHIVE_HASH)
    throw new Error("retained archive hash identity");
  return withZip(archive, LIMITS.compressed, async (zip) => {
    const members = await inventory(zip);
    if (command === "inventory")
      return {
        members: serialized(members),
        coverage: "metadata only; CRC/row quality not established",
        httpRequests: 0,
      };
    return {
      ...(await integrity(
        zip,
        members,
        Number(v.get("--max-expanded")),
        Number(v.get("--max-seconds")),
      )),
      httpRequests: 0,
    };
  });
}
export async function run(args: string[]) {
  return dispatchCommand(args, HELP, runCommand);
}
async function runCommand(command: string, rest: string[]) {
  if (generalCommand(command)) return runGeneral(command, rest);
  const v = options(command, rest);
  if (command === "list")
    return {
      selection: SELECTION,
      rows: 25,
      network: false,
      coverage: "partial first25 Property records",
    };
  if (["inventory", "integrity"].includes(command)) return inspect(command, v);
  if (command === "import")
    selected(v.get("--selection")!, Number(v.get("--rows")));
  const store = await Store.open(v.get("--output")!);
  try {
    if (command === "status") return store.status();
    if (command === "verify") return await store.verify();
    return await store.import(
      v.get("--archive")!,
      v.get("--layout")!,
      v.get("--selection")!,
      Number(v.get("--rows")),
    );
  } finally {
    await store.close();
  }
}
const HELP = commandHelp({
  ...OPTIONS,
  ...Object.fromEntries(
    Object.entries(REQUIRED).map(([k, v]) => [
      k,
      [...v, ...(OPTIONAL[k] ?? [])].map((x) => "--" + x),
    ]),
  ),
});
async function main(args: string[]) {
  const text = information(args, HELP, EXAMPLES);
  await writeOutput(text ?? JSON.stringify(await run(args)) + "\n");
}
if (import.meta.main) main(process.argv.slice(2)).catch(failure);
