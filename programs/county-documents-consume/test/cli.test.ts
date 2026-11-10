import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { run } from "../src/cli";
import { sources } from "../src/adapters";
test("CLI requires explicit source and bound; offline list/status/verify never constructs HTTP", async () => {
  const root = await realpath(
    await mkdtemp(join(process.env.TMPDIR!, "cli-test-")),
  );
  try {
    await expect(run(["list", "--root", root])).rejects.toThrow();
    await expect(
      run(["list", "--root", root, "--source", "county-code", "--limit", "0"]),
    ).rejects.toThrow();
    const html = join(root, "input.html");
    await Bun.write(html, `<a href="/two.pdf">Chapter 2 Code</a>`);
    expect(
      await run([
        "import-page",
        "--root",
        root,
        "--source",
        "county-code",
        "--page",
        sources["county-code"].pages[0],
        "--input",
        html,
        "--origin",
        "retained-fixture",
      ]),
    ).toMatchObject({ occurrences: 1 });
    expect(
      await run([
        "list",
        "--root",
        root,
        "--source",
        "county-code",
        "--chapter",
        "2",
        "--limit",
        "1",
      ]),
    ).toHaveLength(1);
    expect(await run(["status", "--root", root])).toMatchObject({
      observations: 1,
      attempts: 0,
    });
    await expect(
      run([
        "verify",
        "--root",
        root,
        "--source",
        "county-code",
        "--chapter",
        "2",
        "--limit",
        "1",
      ]),
    ).rejects.toThrow("incomplete");
    await expect(
      run([
        "discover",
        "--root",
        root,
        "--source",
        "county-code",
        "--page",
        sources["county-code"].pages[0],
      ]),
    ).rejects.toThrow("--allow-network");
    await expect(
      run([
        "list",
        "--root",
        root,
        "--source",
        "county-code",
        "--limit",
        "1junk",
      ]),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
