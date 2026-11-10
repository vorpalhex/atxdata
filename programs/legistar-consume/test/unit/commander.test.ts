import { expect, test } from "bun:test";
import { Command } from "commander";
import * as cli from "../../src/cli";

test("fresh Legistar Commander definitions retain all five command surfaces", () => {
  const create = (cli as Record<string, unknown>).createProgram;
  expect(typeof create).toBe("function");
  if (typeof create !== "function") return;
  const first = create() as Command;
  const second = create() as Command;
  expect(first).toBeInstanceOf(Command);
  expect(first).not.toBe(second);
  expect(first.commands.map((command) => command.name())).toEqual([
    "list-meetings-page",
    "list-meetings",
    "ingest-meeting",
    "backfill",
    "retry-failed",
  ]);
  const ingest = first.commands.find(
    (command) => command.name() === "ingest-meeting",
  )!;
  ingest.parseOptions(["--event-id=59", "--date", "ignored"]);
  expect(ingest.opts()).toMatchObject({
    eventId: 59,
    date: "ignored",
    body: "City Council",
  });
  expect(
    second.commands
      .find((command) => command.name() === "ingest-meeting")!
      .opts(),
  ).not.toHaveProperty("eventId");
  expect(ingest.helpInformation()).toContain("stderr warning");
});
