import { expect, test } from "bun:test";
import { runCli, httpSetting } from "../src/cli";
import { makeTestDirectory } from "../../legistar-consume/test/support/temp-dir";
import { rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { join } from "node:path";

test("CLI builds its configured real client and persists ingestion across processes", async () => {
  const event = {
    id: 59,
    eventName: "Court",
    eventDate: "2021-01-05T09:00:00Z",
    publishedFiles: [],
  };
  const agents: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      agents.push(request.headers.get("User-Agent") ?? "");
      return Response.json(
        new URL(request.url).pathname === "/v1/Events/59"
          ? event
          : { value: [event] },
      );
    },
  });
  const env = {
    CIVICCLERK_API_BASE: `${server.url}v1/`,
    HTTP_MAX_RETRIES: "0",
    HTTP_TIMEOUT_MS: "2000",
    HTTP_MIN_INTERVAL_MS: "0",
    HTTP_USER_AGENT: "civic-cli-test",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  const root = makeTestDirectory("civic-cli-");
  const lines: string[] = [];
  try {
    Object.assign(process.env, env);
    await runCli(
      ["list-meetings", "--from", "2021-01-05", "--to", "2021-01-05"],
      undefined,
      (line) => lines.push(line),
    );
    await runCli(
      ["ingest-meeting", "--event-id", "59", "--output", root],
      undefined,
      (line) => lines.push(line),
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "src/cli.ts",
        "ingest-meeting",
        "--event-id",
        "59",
        "--output",
        root,
      ],
      {
        cwd: import.meta.dir + "/..",
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(await child.exited).toBe(0);
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
      downloaded: 0,
      skipped: 0,
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      [{ ...event, eventDate: "2021-01-05T09:00:00.000Z" }],
      { downloaded: 0, skipped: 0 },
    ]);
    expect(agents).toEqual([
      "civic-cli-test",
      "civic-cli-test",
      "civic-cli-test",
    ]);
    const db = new Database(join(root, "civicclerk.sqlite"), {
      readonly: true,
    });
    try {
      expect(db.query("SELECT count(*) AS n FROM meetings").get()).toEqual({
        n: 1,
      });
      expect(
        db
          .query(
            "SELECT count(*) AS n FROM ingest_runs WHERE status='succeeded'",
          )
          .get(),
      ).toEqual({ n: 2 });
    } finally {
      db.close();
    }
  } finally {
    server.stop(true);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("parses optional HTTP integer configuration strictly", () => {
  const key = "CIVICCLERK_TEST_INTEGER";
  const previous = process.env[key];
  try {
    delete process.env[key];
    expect(httpSetting(key)).toBeUndefined();
    process.env[key] = "123";
    expect(httpSetting(key)).toBe(123);
    for (const value of ["NaN", "1.5", "-1", "9007199254740992"]) {
      process.env[key] = value;
      expect(() => httpSetting(key)).toThrow();
    }
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("CLI rejects invalid HTTP settings without reaching the network", async () => {
  for (const value of ["garbage", "-1", "1.5", "9007199254740992", "0"]) {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "src/cli.ts",
        "list-meetings",
        "--from",
        "2021-01-01",
        "--to",
        "2021-01-01",
      ],
      {
        cwd: import.meta.dir + "/..",
        env: { ...process.env, HTTP_TIMEOUT_MS: value },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toMatch(/invalid/i);
  }
});

test("CLI routes list and ingest commands and emits JSON", async () => {
  const calls: unknown[] = [];
  const lines: string[] = [];
  const api = {
    async listEvents(from: string, to: string) {
      calls.push([from, to]);
      return [
        {
          id: 59,
          eventName: "Court",
          eventDate: "2021-01-01T00:00:00.000Z",
          publishedFiles: [],
        },
      ];
    },
    async downloadEvent(id: number, output: string) {
      calls.push([id, output]);
      return { downloaded: 1, skipped: 0 };
    },
  };
  await runCli(
    ["list-meetings", "--from", "2021-01-01", "--to", "2021-01-31"],
    api,
    (line) => lines.push(line),
  );
  await runCli(
    ["ingest-meeting", "--event-id", "59", "--output", "documents"],
    api,
    (line) => lines.push(line),
  );
  expect(calls).toEqual([
    ["2021-01-01", "2021-01-31"],
    [59, "documents"],
  ]);
  expect(lines.map((line) => JSON.parse(line))).toMatchObject([
    [{ id: 59 }],
    { downloaded: 1, skipped: 0 },
  ]);
});

test("CLI rejects malformed options before invoking client", async () => {
  const api = {
    async listEvents() {
      throw new Error("unexpected request");
    },
    async downloadEvent() {
      throw new Error("unexpected request");
    },
  };
  for (const args of [
    ["wrong"],
    ["list-meetings"],
    ["list-meetings", "--from", "2021-02-29", "--to", "2021-03-01"],
    ["ingest-meeting", "--event-id", "01", "--output", "docs"],
    ["ingest-meeting", "--event-id", "1e2", "--output", "docs"],
    ["ingest-meeting", "--event-id", "59"],
    ["ingest-meeting", "--event-id", "9007199254740992", "--output", "docs"],
    ["list-meetings", "--extra", "x"],
  ]) {
    await expect(runCli(args, api)).rejects.toThrow(/usage|date|option|ID/i);
  }
});
