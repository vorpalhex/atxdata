import { expect, test } from "bun:test";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main, rejectProtectedSelectors } from "../../src/cli";
import { CheckedOutput } from "../../src/util/output";

test("token guard distinguishes required values, ordinary operands and protected selectors", () => {
  for (const args of [
    [],
    ["--help"],
    ["help", "ingest-meeting"],
    ["ingest-meeting", "--date=--help"],
    ["ingest-meeting", "--date", "--help"],
    ["ingest-meeting", "--date"],
    ["ingest-meeting", "--", "--help"],
    ["list-meetings", "--body", "help", "--", "literal"],
  ])
    expect(() => rejectProtectedSelectors(args)).not.toThrow();
  for (const args of [
    ["--", "list-meetings"],
    ["--", "help"],
    ["help", "--", "ingest-meeting"],
    ["--body", "help", "--", "list-meetings"],
    ["--body", "ordinary", "--", "list-meetings"],
  ])
    expect(() => rejectProtectedSelectors(args)).toThrow(
      "Unexpected protected operand",
    );
});

test("imported Commander entrypoint handles offline help and parser failure", async () => {
  const previous = process.exitCode;
  try {
    await main([process.execPath, "cli.ts", "--help"]);
    expect(process.exitCode).toBe(0);
    await main([process.execPath, "cli.ts", "--invalid"]);
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous ?? 0;
  }
});

test("shared checked writer preserves queued multibyte bytes and observes readonly failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "writer-quality-"));
  const path = join(root, "bytes");
  const fd = openSync(path, "w");
  try {
    const output = new CheckedOutput(fd);
    const text = "☃é".repeat(3000);
    output.text(text);
    output.line("end");
    await output.flush();
    expect(readFileSync(path, "utf8")).toBe(text + "end\n");
    const readonly = openSync(path, "r");
    try {
      const failed = new CheckedOutput(readonly);
      failed.line("not delivered");
      await expect(failed.flush()).rejects.toThrow("EBADF");
      failed.line("failure remains terminal");
      await expect(failed.flush()).rejects.toThrow("EBADF");
      expect(readFileSync(path, "utf8")).toBe(text + "end\n");
    } finally {
      closeSync(readonly);
    }
  } finally {
    closeSync(fd);
    rmSync(root, { recursive: true, force: true });
  }
});
