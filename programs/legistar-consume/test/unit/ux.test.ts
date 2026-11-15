import * as cli from "../../src/cli";
import { setLogWriter } from "../../src/util/logger";
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../../src/cli.ts");
const fixture = resolve(import.meta.dir, "../support/frontend-fixture.ts");
function run(args: string[], env: Record<string, string> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "leg-ux-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["run", "--no-install", "--preload", fixture, entry, ...args],
      {
        cwd,
        encoding: "utf8",
        timeout: 7000,
        env: {
          ...process.env,
          TZ: "UTC",
          BACKFILL_MEETING_DELAY_MS: "0",
          HOME: cwd,
          XDG_CACHE_HOME: join(cwd, "cache"),
          DATA_PATH: join(cwd, "data"),
          LEGISTAR_API_BASE: "https://fixture.invalid/v1",
          CLI_FIXTURE_QUERIES: join(cwd, "queries"),
          ...env,
        },
      },
    );
    return {
      ...result,
      queries: readdirSync(cwd).includes("queries")
        ? readFileSync(join(cwd, "queries"), "utf8")
        : "",
      files: readdirSync(cwd).filter((p) => p !== "cache"),
      checkpoint: readdirSync(cwd).includes("batch.json")
        ? JSON.parse(readFileSync(join(cwd, "batch.json"), "utf8"))
        : undefined,
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("friendly dates resolve by local calendar day with strict bounded syntax", () => {
  const parse = cli.resolveCliDate;
  expect(typeof parse).toBe("function");
  const now = new Date(2024, 1, 28, 23, 30);
  for (const [input, expected] of Object.entries({
    "2024-02-29": "2024-02-29",
    today: "2024-02-28",
    yesterday: "2024-02-27",
    tomorrow: "2024-02-29",
    "30 days": "2024-03-29",
    "-30 days": "2024-01-29",
    "+2 weeks": "2024-03-13",
    "1 week": "2024-03-06",
    "2 days ago": "2024-02-26",
    "in 2 days": "2024-03-01",
    "36500 days": "2124-02-04",
    "-36500 days": "1924-03-24",
  }))
    expect(parse(input, now)).toBe(expected);
  expect(() => parse("next month", now)).toThrow("use YYYY-MM-DD");
  for (const value of [
    "",
    "2023-02-29",
    "2024-2-28",
    "next month",
    "1.5 days",
    "-2 days ago",
    "100000000000 days",
    "2024-02-28T00:00:00Z",
  ]) {
    expect(() => parse(value, now)).toThrow();
  }
});

test("listing defaults independently to minus/plus 30 local days and resolves friendly bounds", () => {
  const now = new Date();
  const from = cli.resolveCliDate("-30 days", now);
  const to = cli.resolveCliDate("30 days", now);
  const exclusiveTo = cli.resolveCliDate("31 days", now);
  const result = run(["list-meetings"], { CLI_FIXTURE_DATE_FROM_QUERY: "1" });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`${from} through ${to}`);
  expect(result.queries).toContain(`datetime'${from}'`);
  expect(result.queries).toContain(`datetime'${exclusiveTo}'`);
  for (const args of [
    ["list-meetings", "--from=yesterday", "--to=30 days"],
    ["list-meetings", "--to", "in 2 weeks"],
    ["ingest-meeting", "--date=today"],
    ["backfill", "--from=today", "--to=tomorrow"],
  ])
    expect(run(args, { CLI_FIXTURE_DATE_FROM_QUERY: "1" }).status).toBe(0);
});

test("listing defaults to readable results and explicit JSON keeps NDJSON on either side", () => {
  const args = ["list-meetings", "--from=2021-01-05", "--to=2021-01-05"];
  const human = run(args);
  expect(human.status).toBe(0);
  expect(human.stdout).toContain("City Council");
  expect(human.stdout).toContain("2021-01-05");
  expect(human.stdout).toContain("59");
  expect(human.stdout).not.toContain('"eventId"');
  for (const argv of [
    ["--json", ...args],
    [...args, "--json"],
  ]) {
    const result = run(argv);
    expect(result.status).toBe(0);
    expect(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      {
        eventId: 59,
        date: "2021-01-05",
        time: "9:00 AM",
        body: "City Council",
        agendaStatus: null,
        minutesStatus: null,
        location: "Fixture",
      },
    ]);
  }
});

test("ingest/backfill human summaries keep progress on stderr and JSON summaries stay stable", () => {
  for (const args of [
    ["ingest-meeting", "--event-id=59"],
    ["backfill", "--from=2021-01-05", "--to=2021-01-05"],
  ]) {
    const human = run(args);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("succeeded");
    expect(human.stdout).toContain("Documents:");
    expect(human.stdout).not.toContain('"event"');
    expect(human.stderr).toContain('"event":"meeting.start"');
    const machine = run([...args, "--json"]);
    expect(machine.status).toBe(0);
    const summary = JSON.parse(machine.stdout);
    expect(summary).toMatchObject({
      event: "run.summary",
      status: "succeeded",
      meetingsProcessed: 1,
      documentsFailed: 0,
    });
    expect(machine.stderr).toContain('"event":"meeting.start"');
  }
});

test("page listing stays resumable JSON on disk while stdout defaults to human", () => {
  const args = [
    "list-meetings-page",
    "--from=2021-01-05",
    "--to=2021-01-05",
    "--checkpoint=batch.json",
  ];
  const human = run(args);
  expect(human.status).toBe(0);
  expect(human.stdout).toContain("Checkpoint: batch.json");
  expect(human.stdout).toContain("complete");
  expect(human.stdout).toContain("City Council");
  expect(human.stdout).not.toContain('"continuation"');
  expect(human.checkpoint).toMatchObject({ complete: true });
  expect(human.checkpoint).not.toHaveProperty("continuation");
  const machine = run(["--json", ...args]);
  expect(machine.status).toBe(0);
  expect(JSON.parse(machine.stdout)).toEqual(machine.checkpoint);
});

test("empty listings and incomplete batches have explicit human and machine contracts", () => {
  const args = ["list-meetings", "--from=2021-01-05", "--to=2021-01-05"];
  const human = run(args, { CLI_FIXTURE_EMPTY: "1" });
  expect(human.status).toBe(0);
  expect(human.stdout).toContain("0 meeting(s)");
  const machine = run([...args, "--json", "--json"], {
    CLI_FIXTURE_EMPTY: "1",
  });
  expect(machine.status).toBe(0);
  expect(machine.stdout).toBe("");
  const batch = run([
    "list-meetings-page",
    "--from=2021-01-05",
    "--to=2021-01-05",
    "--max-pages=1",
    "--checkpoint=batch.json",
  ]);
  expect(batch.status).toBe(0);
  expect(batch.stdout).toContain("incomplete");
  expect(batch.stdout).toContain("resume");
  expect(batch.checkpoint).toMatchObject({
    complete: false,
    continuation: { offset: 1 },
  });
});

test("failed jobs keep truthful summaries and nonzero status in both modes", () => {
  for (const args of [
    ["ingest-meeting", "--event-id=59"],
    ["backfill", "--from=2021-01-05", "--to=2021-01-05"],
  ]) {
    const human = run(args, { CLI_FIXTURE_FAIL: "1" });
    expect(human.status).toBe(1);
    expect(human.stdout).toContain(": failed");
    expect(human.stdout).not.toContain("succeeded");
    const machine = run([...args, "--json"], { CLI_FIXTURE_FAIL: "1" });
    expect(machine.status).toBe(1);
    expect(JSON.parse(machine.stdout)).toMatchObject({
      event: "run.summary",
      status: "failed",
      meetingsProcessed: 0,
    });
  }
});

test("local help explains date grammar, machine mode, and examples offline", () => {
  const result = run(["list-meetings", "--help"], {
    HTTP_TIMEOUT_MS: "invalid",
  });
  expect(result.status).toBe(0);
  for (const text of ["--json", "Examples:", "today", "weeks", "30 days"])
    expect(result.stdout).toContain(text);
  expect(result.stderr).toBe("");
  expect(result.files).toEqual([]);
});

test("relative date validation rejects unsafe scopes before state or requests", () => {
  for (const args of [
    ["list-meetings", "--from=tomorrow", "--to=yesterday"],
    ["list-meetings", "--from=next month"],
    ["list-meetings", "--from="],
    ["list-meetings", "--to=36501 days"],
    ["ingest-meeting", "--date=2023-02-29"],
    ["backfill"],
    ["backfill", "--from=today"],
    [
      "list-meetings-page",
      "--from=today",
      "--to=tomorrow",
      "--checkpoint=batch.json",
    ],
    ["--json", "--", "list-meetings"],
    ["list-meetings", "--from=--help"],
    ["list-meetings", "--", "--json"],
  ]) {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
    expect(result.queries).toBe("");
    expect(result.files).toEqual([]);
  }
});

test("relative days follow the local calendar across DST and UTC day boundaries", () => {
  const script = `import { resolveCliDate } from ${JSON.stringify(entry)};
    console.log(JSON.stringify([
      resolveCliDate("today", new Date("2024-03-10T05:30:00Z")),
      resolveCliDate("tomorrow", new Date("2024-03-10T05:30:00Z")),
      resolveCliDate("1 day", new Date("2024-03-10T06:30:00Z")),
      resolveCliDate("-1 day", new Date("2024-11-04T05:30:00Z")),
    ]));`;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, TZ: "America/Chicago" },
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    "2024-03-09",
    "2024-03-10",
    "2024-03-11",
    "2024-11-02",
  ]);
  expect(result.stderr).toBe("");
});

test("human summaries explain missing meetings rather than hiding run failures", () => {
  const result = run(["ingest-meeting", "--date=2021-01-05"], {
    CLI_FIXTURE_EMPTY: "1",
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(
    "No meeting found for City Council on 2021-01-05",
  );
});

test("human listings preserve explicit blank values instead of inventing missing-value labels", () => {
  const result = run(
    ["list-meetings", "--from=2021-01-05", "--to=2021-01-05"],
    { CLI_FIXTURE_EMPTY_FIELDS: "1" },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("2021-01-05    City Council");
  expect(result.stdout).toContain("Location: \n");
  expect(result.stdout).toContain("Agenda: ; minutes: \n");
  for (const label of ["Time TBD", "Not specified", "Unknown"])
    expect(result.stdout).not.toContain(label);
});

test("event-ID precedence warns only when a supplied date is actually ignored", () => {
  for (const json of [[], ["--json"]]) {
    const both = run([
      ...json,
      "ingest-meeting",
      "--event-id=59",
      "--date=not-a-date",
    ]);
    expect(both.status).toBe(0);
    const warnings = both.stderr
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === "cli.selector-precedence");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: "warn",
      selector: "event-id",
      ignored: "date",
    });
    for (const selector of [["--event-id=59"], ["--date=2021-01-05"]]) {
      const one = run([...json, "ingest-meeting", ...selector]);
      expect(one.status).toBe(0);
      expect(one.stderr).not.toContain("cli.selector-precedence");
    }
  }
});

test("local help retains native descriptions and the global options section", () => {
  for (const [command, description] of Object.entries({
    "list-meetings": "Discover meeting IDs",
    "list-meetings-page": "List one bounded batch",
    "ingest-meeting": "Download one meeting selected",
    backfill: "Download a range of meetings",
    "retry-failed": "Reserved command",
  })) {
    const result = run([command, "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(description);
    expect(result.stdout).toContain("Global Options:");
    expect(result.stderr).toBe("");
  }
});

test("registered actions query a local API and persist resumable batches and truthful run results", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "leg-actions-"));
  const savedEnv = { ...process.env };
  const savedExit = process.exitCode;
  const queries: URL[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      queries.push(url);
      const event = {
        EventId: 59,
        EventDate: "2021-01-05T00:00:00",
        EventBodyName: "City Council",
      };
      return Response.json(
        url.pathname.endsWith("/EventItems")
          ? []
          : url.pathname.endsWith("/59")
            ? event
            : url.searchParams.get("$skip") === "0"
              ? [event]
              : [],
      );
    },
  });
  try {
    process.env.DATA_PATH = join(cwd, "data");
    process.env.LEGISTAR_API_BASE = server.url.href + "v1";
    process.env.BACKFILL_MEETING_DELAY_MS = "0";
    const parse = (args: string[]) => cli.main(["bun", entry, ...args]);
    const range = ["--from=2021-01-05", "--to=2021-01-05"];
    await parse(["list-meetings", ...range]);
    await parse(["--json", "list-meetings", ...range]);
    expect(queries[0]!.searchParams.get("$filter")).toContain("2021-01-05");
    const first = join(cwd, "first.json");
    const second = join(cwd, "second.json");
    await parse([
      "list-meetings-page",
      ...range,
      "--max-pages=1",
      `--checkpoint=${first}`,
    ]);
    const batch = JSON.parse(readFileSync(first, "utf8"));
    expect(batch).toMatchObject({
      complete: false,
      continuation: { offset: 1 },
    });
    await parse([
      "--json",
      "list-meetings-page",
      ...range,
      `--resume=${first}`,
      `--checkpoint=${second}`,
    ]);
    expect(JSON.parse(readFileSync(second, "utf8"))).toMatchObject({
      complete: true,
    });
    expect(queries.at(-1)!.searchParams.get("$skip")).toBe("1");
    await parse(["ingest-meeting", "--event-id=59", "--date=ignored"]);
    expect(process.exitCode).toBe(0);
    await parse(["--json", "ingest-meeting", "--date=2021-01-05"]);
    expect(process.exitCode).toBe(0);
    await parse(["backfill", ...range]);
    expect(process.exitCode).toBe(0);
    const summaries = readdirSync(join(cwd, "data/runs")).map((file) =>
      JSON.parse(readFileSync(join(cwd, "data/runs", file), "utf8")),
    );
    expect(summaries).toHaveLength(4); // Backfill also persists its per-meeting run.
    for (const summary of summaries)
      expect(summary).toMatchObject({
        status: "succeeded",
        meetingsProcessed: 1,
      });
    const program = cli.createProgram();
    await expect(
      program.parseAsync(["bun", entry, "ingest-meeting"]),
    ).rejects.toThrow("Provide --event-id or --date");
    for (const value of [
      null,
      [],
      false,
      { complete: true, continuation: {} },
      { complete: false, continuation: [] },
      { complete: false },
    ]) {
      const bad = join(cwd, "bad.json");
      writeFileSync(bad, JSON.stringify(value));
      await expect(
        cli
          .createProgram()
          .parseAsync([
            "bun",
            entry,
            "list-meetings-page",
            ...range,
            `--resume=${bad}`,
            `--checkpoint=${second}`,
          ]),
      ).rejects.toThrow("invalid or completed checkpoint");
    }
    expect(JSON.parse(readFileSync(second, "utf8"))).toMatchObject({
      complete: true,
    });
  } finally {
    server.stop(true);
    for (const key of Object.keys(process.env))
      if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    process.exitCode = savedExit;
    setLogWriter((line) => console.log(line));
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("plain invocation is a successful offline introduction with copyable examples", () => {
  const result = run([], { HTTP_TIMEOUT_MS: "invalid" });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("list-meetings");
  expect(result.stdout).toContain("Examples:");
  expect(result.stderr).toBe("");
  expect(result.files).toEqual([]);
});
