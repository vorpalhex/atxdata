import { test, expect } from "bun:test";
import { information, help, commands } from "../src/frontend";
import { main } from "../src/cli";

test("imported contextual information pins command selection and informational precedence", () => {
  for (const command of commands) {
    for (const args of [
      [command, "-h"],
      ["help", command],
      ["--archive", "help", command, "--help"],
    ]) {
      expect(information(args)).toBe(help(command));
    }
  }
  expect(information(["--help"])).toBe(help());
  expect(information(["--version", "help", "unknown"])).toBe(
    "clarity-consume 0.1.0",
  );
  expect(information(["--unknown", "--help"])).toBe(help());
  expect(() => information(["help", "unknown"])).toThrow("Unknown command");
  expect(() => information(["unknown", "--help"])).toThrow("Unknown command");
  for (const args of [
    [],
    ["status"],
    ["--archive", "--help"],
    ["--archive=--help"],
    ["--", "help", "collect"],
    ["--", "--version"],
  ]) {
    expect(information(args)).toBeUndefined();
  }
  expect(information(["help", "--", "collect"])).toBe(help());
});

test("imported execution rejects invalid selection before opening the archive", async () => {
  const archive = process.env.TMPDIR! + "/must-not-open-qm1";
  for (const args of [
    ["collect"],
    ["sync"],
    ["collect", "--election", "009876", "--date", "2026-11-03"],
  ]) {
    await expect(main([...args, "--archive", archive])).rejects.toThrow(
      "exactly one",
    );
  }
  for (const args of [
    ["status", "--election", "009876"],
    ["list", "--date", "2026-11-03"],
    ["verify", "--refresh"],
  ]) {
    await expect(main([...args, "--archive", archive])).rejects.toThrow(
      "only supported",
    );
  }
  await expect(
    main(["status", "--archive", archive, "--", "--help"]),
  ).rejects.toThrow("Usage:");
  await expect(
    main(["collect", "--archive", archive, "--election", "invalid"]),
  ).rejects.toThrow("literal digits-only");
});
