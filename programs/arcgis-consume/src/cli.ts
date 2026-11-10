import { Command as Commander, Option } from "commander";
import { parseCLI as parseOptions } from "./cli-parser";
import { isAbsolute } from "node:path";
import metadata from "../package.json";
import { writeStdout } from "./cli-output";
import { type Dependencies, Archive, limits } from "./archive";
import { Adapter, type Command } from "./adapter";
import { configs, source, type Source } from "./sources";
import { ensure } from "./check";
import { executeSelection, selectionOptions } from "./selection";
import { statFile } from "../../civicclerk-consume/src/archive";
const COMMANDS = [
  "list",
  "rules",
  "discover",
  "collect",
  "sync",
  "status",
  "verify",
];
export function createProgram() {
  const program = new Commander()
    .name("arcgis-consume")
    .description("ArcGIS private, bounded catalog and item acquisition")
    .usage("COMMAND [options]")
    .helpOption(false);
  program.addOption(new Option("-h, --help", "Offline help"));
  program.addOption(
    new Option("--version", "Declared package version, offline"),
  );
  program.addOption(
    new Option("--archive <value>", "Absolute private archive directory"),
  );
  program.addOption(new Option("--source <value>", "Exact source ID"));
  program.addOption(
    new Option(
      "--terms-sha256 <value>",
      "Reviewed catalog or item terms SHA256",
    ),
  );
  program.addOption(
    new Option("--resume <value>", "Matching settled interrupted run ID"),
  );
  program.addOption(new Option("--item <value>", "Catalog-backed item ID"));
  program.addOption(
    new Option("--layer <value>", "Advertised layer ID (zero allowed)"),
  );
  program.addOption(
    new Option("--service <value>", "Assert the selected matching service"),
  );
  program.addOption(
    new Option(
      "--fields <value>",
      "Actual comma-separated fields including OID",
    ),
  );
  program.addOption(
    new Option(
      "--page-size <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--max-records <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--max-pages <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--max-requests <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--max-bytes <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--response-bytes <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--raw-bytes <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--expanded-bytes <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--max-members <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  for (const name of COMMANDS)
    program.command(name).description(name.replaceAll("-", " "));
  return program;
}
function parseCLI(args: string[]) {
  return parseOptions(createProgram(), args);
}
const help = `ArcGIS private, bounded catalog and item acquisition
Usage: bun src/cli.ts COMMAND [options]
Commands: list, rules, discover, collect, sync, status, verify
Workflow (review terms before authorization):
  list -> rules/catalogTerms -> discover -> rules/item terms/layers -> collect
  bun src/cli.ts list
  bun src/cli.ts rules --source tnr --archive ABSOLUTE_PRIVATE_DIRECTORY
  bun src/cli.ts discover --source tnr --archive ABSOLUTE_PRIVATE_DIRECTORY --terms-sha256 CATALOG_TERMS_SHA256
  bun src/cli.ts rules --source tnr --item CATALOG_ITEM_ID --archive ABSOLUTE_PRIVATE_DIRECTORY
  bun src/cli.ts collect --source tnr --item CATALOG_ITEM_ID --layer ADVERTISED_LAYER_ID --archive ABSOLUTE_PRIVATE_DIRECTORY --terms-sha256 ITEM_TERMS_SHA256
Sources: tnr, voter. list returns preset IDs, defaults and legacyArchiveLimits.
--archive is required except list: canonical absolute private directory outside source.
--item selects a catalog-backed ID. --layer selects an advertised layer (zero allowed).
--service asserts the matching service, never arbitrary URL permission.
--fields comma-separated actual fields must include the actual OID.
--terms-sha256: reviewed catalogTerms.sha256 for discover; selected item's terms.sha256 for collect/sync.
--resume RUN_ID: repeat matching selection/budgets after a settled interruption; never steals locks or resets unknown transfers/cooldowns.
Positive safe-integer defaults: --page-size 1000, --max-records 1000000, --max-pages 1000, --max-requests 1000, --max-bytes 268435456, --response-bytes 16777216, --raw-bytes 134217728, --expanded-bytes 536870912, --max-members 1000.
Legacy preset routes: omit --item with --source tnr or voter; bare collect may reuse a verified old preset collection. Explicit --item or sync uses the general acquisition route. collect reuses verified local results; sync requests a new bounded observation. status/verify are offline and require existing state.
Default operational output is JSON; errors use stderr/status 1. No prompts or paging. See README for policy, review and privacy limitations.
`;
function commandHelp(command?: string): string {
  if (!command) return createProgram().helpInformation() + "\n" + help;
  const purpose: Record<string, string> = {
    list: "List preset IDs and general/legacy defaults offline; no archive required.",
    rules:
      "Review catalogTerms and selected item terms; inspect advertised layers. Requires --source and --archive; optional --item.",
    discover:
      "Enumerate catalog item IDs with --source, --archive and reviewed catalog --terms-sha256; bounded by --max-pages.",
    collect:
      "Collect/reuse a verified selection with --source, --archive and reviewed item --terms-sha256; choose --item and advertised --layer for services.",
    sync: "Request a new bounded observation using the same explicit selection/terms options as collect.",
    status: "Inspect existing --archive state offline.",
    verify: "Verify existing --archive checkpoints/history offline; no HTTP.",
  };
  return `ArcGIS ${command}\nUsage: bun src/cli.ts ${command} [options]\n${purpose[command]}\n${createProgram().helpInformation()}\n${help}`;
}
function presetSelection(
  selected: Source | undefined,
  flags: Record<string, string>,
) {
  if (!selected) return selectionOptions(flags);
  return selectionOptions({
    "--item": configs[selected].item,
    ...(selected === "tnr" && !flags["--item"] ? { "--layer": "0" } : {}),
    ...flags,
  });
}
export function parseArgs(args: string[]) {
  const parsed = parseCLI(args);
  const command = parsed.command ?? "";
  ensure(
    [
      "list",
      "rules",
      "discover",
      "collect",
      "sync",
      "status",
      "verify",
    ].includes(command),
    "commands: list, rules, discover, collect, sync, status, verify",
  );
  const flags = parsed.flags;
  const archive = flags["--archive"];
  if (command !== "list")
    ensure(
      archive && isAbsolute(archive),
      "--archive must be absolute, private and outside source",
    );
  let selected: Source | undefined;
  if (!["list", "status", "verify"].includes(command))
    selected = source(flags["--source"]);
  const termsSha256 = flags["--terms-sha256"];
  if (["discover", "collect", "sync"].includes(command))
    ensure(
      /^[a-f0-9]{64}$/.test(termsSha256 ?? ""),
      "review rules then provide --terms-sha256",
    );
  const resume = flags["--resume"];
  if (resume) ensure(/^[a-f0-9-]{36}$/.test(resume), "invalid run identifier");
  return {
    command,
    archive,
    source: selected,
    termsSha256,
    resume,
    legacyPreset: Object.keys(flags).every((k) =>
      ["--source", "--archive", "--terms-sha256", "--resume"].includes(k),
    ),
    selection: presetSelection(selected, flags),
  };
}
function legacyDispatch(
  options: ReturnType<typeof parseArgs>,
  archive: Archive,
) {
  return (
    options.legacyPreset &&
    ((options.resume && !archive.store.options(options.resume)) ||
      (options.command === "collect" &&
        !options.resume &&
        archive.store.latestCollection(options.source!)))
  );
}
async function executeArchive(
  options: ReturnType<typeof parseArgs>,
  archive: Archive,
): Promise<unknown> {
  if (options.command === "status")
    return {
      ...archive.store.status(),
      integrity: archive.store.integrity(),
      limits,
    };
  const adapter = new Adapter(archive);
  if (options.command === "verify") return await adapter.verify();
  if (legacyDispatch(options, archive))
    return await adapter.execute(
      options.source!,
      options.command as Command,
      options,
    );
  if (options.selection)
    return await executeSelection(
      archive,
      options.source!,
      options.command as Command,
      { ...options, ...options.selection },
    );
  return await adapter.execute(
    options.source!,
    options.command as Command,
    options,
  );
}
export async function main(
  args: string[],
  dependencies: Partial<Dependencies> = {},
): Promise<unknown> {
  const parsed = parseCLI(args);
  if (parsed.info === "version") return `arcgis-consume ${metadata.version}`;
  if (parsed.info === "help") return commandHelp(parsed.command);
  if (!parsed.command) throw Error(commandHelp());
  const options = parseArgs(args);
  if (options.command === "list")
    return Object.entries(configs).map(([id, c]) => {
      const s = selectionOptions({ "--item": c.item })!;
      return {
        id,
        ...c,
        limits: {
          ...s.budget,
          records: s.maxRecords,
          maxPages: s.maxPages,
          pageSize: s.pageSize,
          expandedBytes: s.expandedBytes,
          zipMembers: s.maxMembers,
        },
        legacyArchiveLimits: limits,
      };
    });
  const root = options.archive!;
  if (["status", "verify"].includes(options.command))
    ensure(
      await statFile(root + "/state.sqlite"),
      "archive state does not exist",
    );
  const archive = await Archive.open(root, dependencies);
  try {
    return await executeArchive(options, archive);
  } finally {
    await archive.close();
  }
}
if (import.meta.main) {
  try {
    const result = await main(Bun.argv.slice(2));
    await writeStdout(
      (typeof result === "string" ? result : JSON.stringify(result, null, 2)) +
        "\n",
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message.replace(/https:\/\/\S+\?\S+/g, "[private request URL]")
        : "collector failed",
    );
    process.exitCode = 1;
  }
}
