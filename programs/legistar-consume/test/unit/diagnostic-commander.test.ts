import { expect, test } from "bun:test";
import { Command } from "commander";
import * as diagnostic from "../../scripts/check-legistar-api";

test("diagnostic uses Commander definitions and generated help without transport", async () => {
  const create = (diagnostic as Record<string, unknown>)
    .createDiagnosticProgram;
  expect(typeof create).toBe("function");
  if (typeof create !== "function") return;
  const program = create() as Command;
  expect(program).toBeInstanceOf(Command);
  program.parseOptions(["-h", "--version"]);
  expect(program.opts()).toEqual({ help: true, version: true });
  const lines: string[] = [];
  await diagnostic.main(["--help"], {
    line: (text) => {
      lines.push(text);
    },
    flush: async () => {},
  });
  expect(lines.join("\n")).toContain(program.helpInformation());
});
