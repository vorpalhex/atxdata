import { test, expect } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  constants,
} from "node:fs";
const entry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const commands = [
  "list",
  "rules",
  "discover",
  "collect",
  "sync",
  "status",
  "verify",
];
test("native contextual help/version bypass unusable configuration and never reinterpret values", async () => {
  const cwd = await mkdtemp(join(process.env.TMPDIR!, "frontend-native-"));
  try {
    const invoke = (args: string[]) =>
      spawnSync(process.execPath, [entry, ...args], {
        cwd,
        env: {
          ...process.env,
          HOME: cwd,
          XDG_CONFIG_HOME: cwd,
          TERM: "dumb",
          NO_COLOR: "1",
        },
        input: "",
        encoding: "utf8",
        timeout: 10000,
      });
    for (const args of [
      ["-h"],
      ["--help"],
      ["help"],
      ["--version"],
      ...commands.flatMap((c) => [
        [c, "-h"],
        [c, "--help"],
        ["help", c],
      ]),
    ]) {
      const result = invoke([...args, "--archive", "/dev/null"]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        args[0] === "--version" ? "0.1.0" : "Usage:",
      );
      expect(result.stdout).not.toContain("\x1b");
    }
    expect(await readdir(cwd)).toEqual([]);
    // Bun consumes the first --; the second reaches the application parser.
    for (const args of [
      ["--source", "--help"],
      ["--source=--help"],
      ["--", "--", "--help"],
      ["help", "unknown"],
    ]) {
      const result = invoke(args);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain(" at ");
    }
    const args = ["--source=tnr", "list"];
    const healthy = invoke(args);
    expect(healthy.status).toBe(0);
    expect(healthy.stderr).toBe("");
    expect(() => JSON.parse(healthy.stdout)).not.toThrow();
    for (const invalid of [
      ["list", "--source="],
      ["list", "--source", "tnr", "--source", "voter"],
      ["list", "--bogus"],
      ["list", "extra"],
    ]) {
      const result = invoke(invalid);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("native stdout failure is nonzero and closed pipe stays quiet", async () => {
  const cwd = await mkdtemp(join(process.env.TMPDIR!, "frontend-output-"));
  try {
    const file = join(cwd, "readonly");
    writeFileSync(file, "unchanged");
    for (const args of [["--help"], ["list"]]) {
      const fd = openSync(file, "r");
      try {
        const result = spawnSync(process.execPath, [entry, ...args], {
          cwd,
          env: process.env,
          stdio: ["ignore", fd, "pipe"],
          encoding: "utf8",
          timeout: 10000,
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/stdout.*EBADF/);
        expect(result.stderr).not.toContain(cwd);
        expect(result.stderr).not.toContain(" at ");
      } finally {
        closeSync(fd);
      }
    }
    expect(readFileSync(file, "utf8")).toBe("unchanged");
    const child = spawn(process.execPath, [entry, "--help"], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.destroy();
    let stderr = "";
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    const status = await new Promise((resolve) => child.on("close", resolve));
    expect(status).toBe(0);
    expect(stderr).toBe("");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("writer bounds a blocked reader and completely flushes a healthy large result", async () => {
  const module = fileURLToPath(
    new URL("../src/cli-output.ts", import.meta.url),
  );
  const code = `import {writeStdout} from ${JSON.stringify(module)};try{await writeStdout('x'.repeat(8*1024*1024));}catch(e){console.error(e.message);process.exitCode=1;}`;
  const healthy = spawnSync(process.execPath, ["-e", code], {
    env: process.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10000,
  });
  expect(healthy.status).toBe(0);
  expect(healthy.stdout.length).toBe(8 * 1024 * 1024);
  expect(healthy.stderr).toBe("");
  // A real FIFO avoids Bun's child-process pipe auto-buffering in the parent.
  if (process.platform === "win32") return; // POSIX FIFO portion is not portable to Windows.
  const cwd = await mkdtemp(join(process.env.TMPDIR!, "frontend-fifo-")),
    fifo = join(cwd, "pipe");
  expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
  const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  const writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
  try {
    const child = spawn(process.execPath, ["-e", code], {
      env: process.env,
      stdio: ["ignore", writer, "pipe"],
    });
    let stderr = "";
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 8000);
    const status = await new Promise((resolve) => child.on("close", resolve));
    clearTimeout(watchdog);
    expect(status).toBe(1);
    expect(stderr).toContain("ETIMEDOUT");
  } finally {
    closeSync(writer);
    closeSync(reader);
    await rm(cwd, { recursive: true, force: true });
  }
}, 15000);
