import { test, expect } from "bun:test";
import * as frontend from "../src/frontend";

test("Commander owns command metadata, help and option consumption", () => {
  const factory = (frontend as Record<string, unknown>).createCommand;
  expect(typeof factory).toBe("function");
  const command = (factory as () => any)();
  expect(command.constructor.name).toBe("Command");
  expect(command.commands.map((child: any) => child.name())).toEqual([
    "list",
    "discover",
    "collect",
    "sync",
    "status",
    "verify",
  ]);
  expect(command.helpInformation()).toContain("Commands:");
  command.parse(["--archive" + "=private", "status"], { from: "user" });
  expect(command.opts().archive).toBe("private");
  expect(command.args[0]).toBe("status");
  expect(() =>
    (factory as () => any)().parse(["--unknown"], { from: "user" }),
  ).toThrow();
});

test("native loose information preserves missing values, short help groups and dash operands", () => {
  const entry = new URL("../src/cli.ts", import.meta.url).pathname;
  for (const args of [["--help", "--archive"], ["-h=foo"], ["-xh"]]) {
    const child = Bun.spawnSync([process.execPath, entry, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toContain("Usage:");
    expect(child.stderr.toString()).toBe("");
  }
  const child = Bun.spawnSync(
    [process.execPath, entry, "--unknown", "-", "--help"],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  expect(child.exitCode).toBe(1);
  expect(child.stderr.toString()).toContain("--help");
  expect(child.stdout.toString()).not.toContain("Usage:");
});
