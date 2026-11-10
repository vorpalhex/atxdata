import { test, expect } from "bun:test";
import { run } from "../src/cli";
import { mkdtemp, access, rm } from "node:fs/promises";
import { join } from "node:path";

const commands = [
  "list",
  "verify",
  "status",
  "catalog",
  "import-page",
  "import-pdf",
  "review-pdf",
  "review-context",
  "discover",
  "collect",
  "sync",
  "archive",
];
test("imported contextual help preserves command and information precedence", async () => {
  expect(await run([])).toContain("County document acquisition");
  for (const command of commands) {
    for (const args of [
      [command, "-h"],
      ["help", command],
      [command, "--help"],
    ]) {
      const result = await run([...args, "--root", "/dev/null"]);
      expect(result).toContain(`County document ${command}\nUsage:`);
      expect(result).toContain("Sources:");
    }
  }
  for (const args of [
    ["--bogus", "--help"],
    ["status", "--root", "a", "--root", "b", "--help"],
    ["--human=false", "--help"],
  ])
    expect(await run(args)).toContain("Usage:");
  expect(await run(["--help", "--version"])).toBe(
    "county-documents-consume 0.1.0",
  );
  expect(await run(["--version", "--help"])).toContain("Usage:");
  await expect(run(["help", "unknown"])).rejects.toThrow("unknown command");
  await expect(run(["--bogus", "unknown", "--help"])).rejects.toThrow(
    "unknown command",
  );
});

test("imported token consumption preserves literal values, terminators and first error", async () => {
  const cases: [string[], string][] = [
    [["--root", "--help"], "missing --root value"],
    [["--root=--help"], "required command"],
    [["--", "--help"], "unexpected operand"],
    [["--", "status"], "unexpected operand"],
    [["help", "help"], "unknown command"],
    [["status", "extra"], "unexpected operand"],
    [["status", "--bogus", "--root="], "unknown option"],
    [["status", "--root=", "--bogus"], "missing --root value"],
    [["status", "--root", "a", "--root", "b"], "duplicate option"],
    [["status", "--human=false"], "boolean switches do not take values"],
    [["status", "--human", "--human"], "duplicate option"],
  ];
  for (const [args, message] of cases)
    await expect(run(args)).rejects.toThrow(message);
  // A missing split value consumes its following token, including --version/--.
  for (const value of ["--version", "--"])
    await expect(run(["status", "--root", value])).rejects.toThrow(
      "missing --root value",
    );
  for (const value of ["help", "list", "status", "-h"])
    await expect(run(["--source", value])).rejects.toThrow("required command");
});

test("missing reviewed image preflights before archive creation; valid equals/split roots still initialize", async () => {
  const temp = await mkdtemp(join(process.env.TMPDIR!, "county-imported-"));
  try {
    const absent = join(temp, "absent");
    await expect(
      run([
        "review-pdf",
        "--root",
        absent,
        "--observation",
        "id",
        "--input",
        "pdf",
        "--review",
        "json",
      ]),
    ).rejects.toThrow("required --image or --images");
    expect(
      await access(absent).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    for (const [i, args] of [
      ["--root", join(temp, "split"), "status"],
      ["status", `--root=${join(temp, "equals")}`],
    ].entries()) {
      expect(await run(args)).toMatchObject({ observations: 0, attempts: 0 });
      expect(
        await access(
          join(temp, i === 0 ? "split" : "equals", "documents.sqlite"),
        ).then(
          () => true,
          () => false,
        ),
      ).toBe(true);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("imported review accepts either single image mode before checking retained files", async () => {
  const temp = await mkdtemp(join(process.env.TMPDIR!, "county-review-mode-"));
  try {
    for (const mode of ["--image", "--images"]) {
      const root = join(temp, mode.slice(2));
      await expect(
        run([
          "review-pdf",
          "--root",
          root,
          "--observation",
          "id",
          "--input",
          join(temp, "absent-pdf"),
          "--review",
          join(temp, "absent-review"),
          mode,
          join(temp, "absent-images"),
        ]),
      ).rejects.toThrow("input missing or exceeds byte limit");
      expect(
        await access(join(root, "documents.sqlite")).then(
          () => true,
          () => false,
        ),
      ).toBe(true);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("informational option assignments remain unknown, not operational booleans", async () => {
  const invoke = run;
  for (const flag of ["--help=value", "--version=value"]) {
    const error = await invoke([flag]).then(
      () => null,
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("unknown option");
  }
});

test("legacy grouped short-looking operands are not informational options", async () => {
  for (const args of [["-hh"], ["-hh", "--help"], ["help", "-hh"]]) {
    const error = await run(args).then(
      () => null,
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("unknown command");
  }
  const error = await run(["status", "-hh"]).then(
    () => null,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("unexpected operand");
});
