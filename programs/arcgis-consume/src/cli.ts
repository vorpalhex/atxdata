import { isAbsolute } from "node:path";
import { Archive, limits } from "./archive";
import { Adapter, type Command } from "./adapter";
import { configs, source, type Source } from "./sources";
import { ensure } from "./check";
import { statFile } from "../../civicclerk-consume/src/archive";
function parseFlags(args: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    ensure(
      ["--archive", "--source", "--terms-sha256", "--resume"].includes(key) &&
        value &&
        !value.startsWith("--") &&
        !(key in flags),
      "unknown, duplicate or incomplete option",
    );
    flags[key] = value;
  }
  return flags;
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
  return { command, archive, source: selected, termsSha256, resume };
}
export async function main(args: string[]): Promise<unknown> {
  const options = parseArgs(args);
  if (options.command === "list")
    return Object.entries(configs).map(([id, c]) => ({ id, ...c, limits }));
  const root = options.archive!;
  if (["status", "verify"].includes(options.command))
    ensure(
      await statFile(root + "/state.sqlite"),
      "archive state does not exist",
    );
  const archive = await Archive.open(root);
  try {
    if (options.command === "status")
      return {
        ...archive.store.status(),
        integrity: archive.store.integrity(),
        limits,
      };
    const adapter = new Adapter(archive);
    if (options.command === "verify") return await adapter.verify();
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
