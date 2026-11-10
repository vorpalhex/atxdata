import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";

// Keep this new module-load proof out of the suite process: existing policy
// tests inspect async Error.stack names and Bun changes those frames when this
// extra CLI import runs before them. No existing policy assertions are changed.
test("Commander owns the command registry, option consumption and generated help", () => {
  const entry = new URL("../src/cli.ts", import.meta.url).pathname;
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    import assert from "node:assert/strict";
    import { Command } from "commander";
    const cli = await import(${JSON.stringify(entry)});
    assert.equal(typeof cli.createProgram, "function");
    const program = cli.createProgram();
    assert.ok(program instanceof Command);
    assert.ok(program.commands.some(command => command.name() === "status"));
    assert.ok(program.helpInformation().includes("Commands:"));
    assert.ok(program.helpInformation().includes("--root"));
    assert.equal(program.opts().human, false);
    const parsed = program.parseOptions(["--root=/private-placeholder", "status"]);
    assert.deepEqual(parsed, {operands:["status"], unknown:[]});
    assert.equal(program.opts().root, "/private-placeholder");
    // A definition added directly to Commander must be consumed and documented,
    // not shadowed by a second operational parser or a hard-coded help table.
    program.option("--proof <value>", "test-only definition");
    assert.deepEqual(program.parseOptions(["--proof=literal"]), {operands:[], unknown:[]});
    assert.equal(program.opts().proof, "literal");
    assert.ok(program.helpInformation().includes("test-only definition"));
    console.log("commander-definition-proof");
  `,
    ],
    { env: process.env, encoding: "utf8", timeout: 10000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe("commander-definition-proof\n");
});
