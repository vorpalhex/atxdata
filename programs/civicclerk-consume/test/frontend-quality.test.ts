import { expect, test } from "bun:test";
import { runCli } from "../src/cli";

const usage = /Usage:/;
test("information precedence retains parsing, protected operands and help validation", async () => {
  const render = async (args: string[]) => { const lines: string[] = []; await runCli(args, undefined, line => { lines.push(line); }); return lines.join("\n"); };
  expect(await render(["help"])).toContain("Commands:");
  expect(await render(["list-meetings", "help", "--help"])).toContain("Inclusive dates");
  expect(await render(["unknown", "--help", "--version"])).toContain("Commands:");
  expect(await render(["list-meetings", "--from=x", "--from=y", "--help"])).toContain("Inclusive dates");
  expect(await render(["--version", "--version"])).toBe("civicclerk-consume 0.1.0");
  for (const args of [["help", "unknown"], ["help", "list-meetings", "extra"], ["--help", "--", "operand"], ["list-meetings", "extra"]]) await expect(render(args)).rejects.toThrow(usage);
  await expect(render(["--help", "--unknown"])).rejects.toThrow(/Unknown option/);
  await expect(render(["list-meetings", "--from", "--help"])).rejects.toThrow();
  await expect(render(["list-meetings", "--from=x", "--from=y"])).rejects.toThrow("duplicate option from");
});

test("ingestion option validation and JSON route preserve defaults and subset deduplication", async () => {
  const calls: unknown[] = [], lines: string[] = [];
  const api = { async listEvents() { return []; }, async downloadEvent(...args: unknown[]) { calls.push(args); return { downloaded: 0, skipped: 0 }; } };
  await runCli(["ingest-meeting", "--event-id=59", "--output=private", "--file-types=1,4,1", "--max-bytes=0", "--max-documents=0"], api, line => { lines.push(line); });
  expect(calls).toEqual([[59, "private", { maxBytes: 0, maxDocuments: 0, fileTypes: [1,4] }]]);
  expect(lines).toEqual(['{"downloaded":0,"skipped":0}']);
  await expect(runCli(["ingest-meeting", "--event-id=59", "--output=private", "--file-types=3"], api)).rejects.toThrow("unsupported file types");
  expect(calls.length).toBe(1);
});
