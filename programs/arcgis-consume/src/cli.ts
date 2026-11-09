import { isAbsolute } from "node:path";
import { type Dependencies, Archive, limits } from "./archive";
import { Adapter, type Command } from "./adapter";
import { configs, source, type Source } from "./sources";
import { ensure } from "./check";
import { executeSelection, selectionOptions } from "./selection";
import { statFile } from "../../civicclerk-consume/src/archive";
function parseFlags(args: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    ensure(
      [
        "--archive",
        "--source",
        "--terms-sha256",
        "--resume",
        "--item",
        "--layer",
        "--service",
        "--fields",
        "--page-size",
        "--max-records",
        "--max-pages",
        "--max-requests",
        "--max-bytes",
        "--response-bytes",
        "--raw-bytes",
        "--expanded-bytes",
        "--max-members",
      ].includes(key) &&
        value &&
        !value.startsWith("--") &&
        !(key in flags),
      "unknown, duplicate or incomplete option",
    );
    flags[key] = value;
  }
  return flags;
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
  const command = args[0];
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
  const flags = parseFlags(args);
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
export async function main(
  args: string[],
  dependencies: Partial<Dependencies> = {},
): Promise<unknown> {
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
  } finally {
    await archive.close();
  }
}
if (import.meta.main) {
  try {
    console.log(JSON.stringify(await main(Bun.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message.replace(/https:\/\/\S+\?\S+/g, "[private request URL]")
        : "collector failed",
    );
    process.exitCode = 1;
  }
}
