import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("diagnostic informational and malformed invocation perform zero transport", () => {
  const entry = resolve(import.meta.dir, "../../scripts/check-legistar-api.ts");
  const fixture = resolve(import.meta.dir, "../support/diagnostic-fixture.ts");
  for (const args of [["-h"], ["--help"], ["--version"], ["--invalid"], ["--", "--help"], []]) {
    const cwd = mkdtempSync(join(tmpdir(), "diagnostic-cli-"));
    const calls = join(cwd, "calls");
    try {
      const result = spawnSync(process.execPath, ["run", "--no-install", "--preload", fixture, entry, ...(args[0] === "--" ? ["--", ...args] : args)], { cwd, encoding: "utf8", timeout: 5000, env: { ...process.env, CLI_FIXTURE_CALLS: calls, CLI_FIXTURE_STATS: join(cwd, "stats") } });
      const count = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
      const invalid = args[0] === "--invalid" || args[0] === "--";
      expect(result.status).toBe(invalid ? 1 : 0);
      expect(count).toBe(args.length ? 0 : 9);
      if (!args.length) expect(readFileSync(join(cwd, "stats"), "utf8")).toBe("1");
      if (!args.length) expect(result.stdout).toContain("API is usable without a key for the requested City Council smoke case.");
      else if (!invalid) expect(result.stdout).toContain("check-legistar-api");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }
});

test("diagnostic interrupt stops new checks and exits despite non-cooperative fixture", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "diagnostic-signal-"));
  const calls = join(cwd, "calls");
  const child = Bun.spawn([process.execPath, "run", "--no-install", "--preload", resolve(import.meta.dir, "../support/diagnostic-fixture.ts"), resolve(import.meta.dir, "../../scripts/check-legistar-api.ts")], {
    cwd, env: { ...process.env, CLI_FIXTURE_CALLS: calls, CLI_FIXTURE_DELAY: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const streams = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const deadline = Date.now() + 2000;
  try {
    while (!existsSync(calls) && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(calls)).toBe(true);
    child.kill("SIGINT");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 1500);
    try {
      expect(await child.exited).toBe(130);
      const [stdout, stderr] = await streams;
      expect(stdout).toContain("diagnostic interrupted");
      expect(stderr).toBe("");
      expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
    } finally { clearTimeout(timeout); }
  } finally { child.kill(); await child.exited; rmSync(cwd, { recursive: true, force: true }); }
});
