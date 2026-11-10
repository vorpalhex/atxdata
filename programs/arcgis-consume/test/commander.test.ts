import { test, expect } from "bun:test";
import { Command } from "commander";
import * as cli from "../src/cli";

test("Commander owns the command registry, option consumption and generated help", () => {
  const factory = (cli as unknown as { createProgram?: () => Command })
    .createProgram;
  expect(typeof factory).toBe("function");
  const program = factory!();
  expect(program).toBeInstanceOf(Command);
  expect(program.commands.map((command) => command.name())).toContain("list");
  expect(program.helpInformation()).toContain("Commands:");
  expect(program.helpInformation()).toContain("--layer");
  const parsed = program.parseOptions(["--layer=0", "list"]);
  expect(parsed.operands).toEqual(["list"]);
  expect(parsed.unknown).toEqual([]);
  expect(program.opts().layer).toBe("0");
});
