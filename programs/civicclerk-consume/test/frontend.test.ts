import { expect, test } from "bun:test";
import { runCli } from "../src/cli";

test("offline contextual help and version bypass client construction", async () => {
  const old = process.env.HTTP_TIMEOUT_MS;
  process.env.HTTP_TIMEOUT_MS = "invalid";
  try {
    for (const args of [["--help"], ["-h"], ["--version"], ["list-meetings", "--help"], ["ingest-meeting", "-h"], ["help", "list-meetings"], ["help", "ingest-meeting"]]) {
      const lines: string[] = [];
      await runCli(args, undefined, line => { lines.push(line); });
      expect(lines.join("\n")).toContain("civicclerk-consume");
    }
  } finally { if (old === undefined) delete process.env.HTTP_TIMEOUT_MS; else process.env.HTTP_TIMEOUT_MS = old; }
});

test("help-like values and protected operands are not informational requests", async () => {
  for (const args of [["list-meetings", "--from=--help", "--to=2021-01-01"], ["list-meetings", "--from", "--help", "--to", "2021-01-01"], ["list-meetings", "--", "--help"], ["--", "help", "list-meetings"], ["help", "--", "list-meetings"], ["--from=2021-01-05", "--to=2021-01-05", "--", "list-meetings"]]) {
    await expect(runCli(args)).rejects.toThrow();
  }
});
