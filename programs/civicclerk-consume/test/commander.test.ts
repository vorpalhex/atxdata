import { expect, test } from "bun:test";
import * as cli from "../src/cli";
import { Command } from "commander";

test("Commander owns CivicClerk option consumption and command help metadata", async () => {
  const create = (cli as Record<string, unknown>).createProgram;
  expect(typeof create).toBe("function");
  if (typeof create !== "function") return;
  const program = create() as Command;
  expect(program).toBeInstanceOf(Command);
  expect(program.commands.map((command) => command.name())).toEqual([
    "list-meetings",
    "ingest-meeting",
  ]);
  program.parseOptions([
    "--from=2021-01-05",
    "list-meetings",
    "--to",
    "2021-01-05",
  ]);
  expect(program.opts()).toMatchObject({
    from: "2021-01-05",
    to: "2021-01-05",
  });
  const lines: string[] = [];
  await cli.runCli(["list-meetings", "--help"], undefined, (text) => {
    lines.push(text);
  });
  expect(lines.join("\n")).toContain(program.commands[0]!.helpInformation());
  expect(lines.join("\n")).toContain(
    "Example: civicclerk-consume list-meetings",
  );
});

test("a lone dash remains a split string value before information flags", async () => {
  for (const option of [
    "from",
    "to",
    "event-id",
    "output",
    "max-pages",
    "max-bytes",
    "max-documents",
    "file-types",
    "checkpoint",
    "resume",
  ]) {
    const lines: string[] = [];
    await cli.runCli(
      [`--${option}`, "-", "list-meetings", "--help"],
      undefined,
      (line) => {
        lines.push(line);
      },
    );
    expect(lines.join("\n")).toContain("Inclusive dates");
  }
});
