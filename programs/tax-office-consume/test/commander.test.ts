import { test, expect } from "bun:test";

test("native operational commands execute registered Commander actions", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(process.env.TMPDIR!, "commander-native-"));
  const preload = join(root, "trace.ts");
  await writeFile(
    preload,
    `
    import { Command } from ${JSON.stringify(import.meta.resolve("commander"))};
    const parse = Command.prototype.parseAsync;
    Command.prototype.parseAsync = function (...args) {
      console.error("TRACE_PARSE");
      return parse.apply(this, args);
    };
    const action = Command.prototype.action;
    Command.prototype.action = function (handler) {
      const name = this.name();
      return action.call(this, function (...args) {
        console.error("TRACE_ACTION:" + name);
        return handler.apply(this, args);
      });
    };
  `,
  );
  const receipts: unknown[] = [];
  async function invoke(args: string[]) {
    const child = Bun.spawn(
      [
        process.execPath,
        "--preload",
        preload,
        import.meta.dir + "/../src/cli.ts",
        ...args,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit).toBe(0);
    expect(stdout.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stderr).toContain("TRACE_PARSE");
    expect(stderr).toContain("TRACE_ACTION:" + args[0]);
    receipts.push({ args, stdout, stderr, exit });
    await writeFile(
      join(root, "receipts.json"),
      JSON.stringify(receipts, null, 2),
    );
    return JSON.parse(stdout);
  }
  await invoke(["status", "--output", join(root, "archive")]);
  await invoke(["list"]);
  const archive = join(root, "catalog"),
    html = join(root, "catalog.html"),
    file = join(root, "fixture.csv");
  await writeFile(html, '<a href="/voterdata/fixture.csv">Fixture CSV</a>');
  await writeFile(file, "SyntheticHeader\nSyntheticValue\n");
  await invoke(["catalog-import", "--output", archive, "--html", html]);
  const catalog = await invoke(["list", "--output", archive]);
  const selected = catalog.items[0].id;
  await invoke([
    "import-export",
    "--output",
    archive,
    "--selection",
    selected,
    "--file",
    file,
    "--catalog-version",
    catalog.version,
  ]);
  const retained = await invoke(["list", "--output", archive]);
  const version = retained.observations[0].version;
  for (const selectors of [
    ["--version", version],
    ["--version=" + version, "--catalog-version=" + catalog.version],
    ["--catalog-version", catalog.version],
  ]) {
    const result = await invoke([
      "collect",
      "--output",
      archive,
      "--selection",
      selected,
      ...selectors,
    ]);
    expect(result.version).toBe(version);
    expect(result.reused).toBe(true);
  }
});

import { help, parseOptions, type Commands } from "../src/frontend";
import { createOptions, createProgram } from "../src/frontend";
import { Command } from "commander";
import { run } from "../src/cli";

test("operational run does not enable Commander implicit help commands", async () => {
  await expect(run(["help"])).rejects.toThrow('unknown command "help"');
});

test("option consumption uses real Commander definitions and events", () => {
  const command = createOptions(["--item", "--refresh"], [], ["--refresh"]);
  expect(command).toBeInstanceOf(Command);
  const events: string[] = [];
  command.on("option:item", (value: string) => events.push(value));
  command.parse(["--item=fixture", "--refresh"], { from: "user" });
  expect(events).toEqual(["fixture"]);
  expect(command.opts()).toEqual({ item: "fixture", refresh: true });
  expect(() => parseOptions(["--item=one", "--item"], ["--item"], [])).toThrow(
    "repeated option",
  );
});

test("first invalid token wins before later option callbacks", () => {
  const parse = (args: string[]) =>
    parseOptions(args, ["--item", "--refresh"], [], ["--refresh"]);
  expect(() => parse(["--unknown", "--item="])).toThrow(
    'unknown option "--unknown"',
  );
  expect(() => parse(["operand", "--item="])).toThrow("unexpected operand;");
  expect(() => parse(["operand", "--"])).toThrow("unexpected operand;");
  expect(() => parse(["--refresh", "--refresh=false"])).toThrow(
    "repeated option --refresh",
  );
});

const commands: Commands = {
  collect: {
    usage: "--item VALUE",
    description: "retain selection",
    options: ["--item"],
  },
};
test("registered commands expose real metadata and Commander action dispatch", () => {
  const program = createProgram(commands);
  const command = program.commands.find(
    (command) => command.name() === "collect",
  )!;
  expect(command.description()).toBe("retain selection");
  expect(
    command.options.find((option) => option.long === "--item")?.required,
  ).toBe(true);
  let selected: string | undefined;
  command.action((options) => {
    selected = options.item;
  });
  program.parse(["collect", "--item", "fixture"], { from: "user" });
  expect(selected).toBe("fixture");
});

test("command help is generated from Commander required-value definitions", () => {
  expect(help(commands, "fixture", "collect")).toContain("--item <VALUE>");
  expect(
    parseOptions(["--item=fixture"], ["--item"], ["--item"]).get("--item"),
  ).toBe("fixture");
});
