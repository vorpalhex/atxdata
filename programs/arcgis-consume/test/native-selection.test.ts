import { test, expect } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Archive } from "../src/archive";
import { item, id } from "./support/selection-fixture";
import { terms } from "../src/rules";

test("native CLI subprocess collects fixture, verifies/reuses offline, and fails closed on query tampering", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "native-selection-"));
  const archive = join(root, "archive"),
    preload = join(root, "fixture.ts");
  const fixture = resolve(import.meta.dir, "support/selection-fixture.ts");
  await writeFile(
    preload,
    `import { fixture } from ${JSON.stringify(fixture)}; const f=fixture(); globalThis.fetch=f.deps.fetch; Date.now=f.deps.now; Bun.sleep=f.deps.sleep;`,
  );
  const cli = resolve(import.meta.dir, "../src/cli.ts");
  const invoke = async (args: string[], online = false) => {
    const p = Bun.spawn(
      [
        process.execPath,
        ...(online ? ["--preload", preload] : []),
        cli,
        ...args,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { stdout, stderr, exit };
  };
  const args = [
    "collect",
    "--archive",
    archive,
    "--source",
    "tnr",
    "--item",
    id,
    "--layer",
    "7",
    "--page-size",
    "4",
    "--terms-sha256",
    terms(item).sha256,
  ];
  const positive = await invoke(args, true);
  expect(positive.exit).toBe(0);
  const result = JSON.parse(positive.stdout);
  expect(result.summary.records).toBe(13);
  const check = await invoke(["verify", "--archive", archive]);
  expect(check.exit).toBe(0);
  expect(JSON.parse(check.stdout).collections).toBe(1);
  const reused = await invoke(args);
  expect(reused.exit).toBe(0);
  expect(JSON.parse(reused.stdout).reused).toBe(true);
  const a = await Archive.open(archive);
  const attempts = a.store.status().attempts;
  a.store.db
    .query("UPDATE observations SET url=? WHERE run=? AND label='page-0'")
    .run(item.url + "/8/query?f=json&where=1%3D0", result.run);
  await a.close();
  const fault = await invoke(["verify", "--archive", archive]);
  expect(fault.exit).toBe(1);
  expect(fault.stderr).toContain("checkpoint identity");
  const after = await Archive.open(archive);
  try {
    expect(after.store.status().attempts).toBe(attempts);
  } finally {
    await after.close();
  }
  await writeFile(
    join(root, "native-receipts.json"),
    JSON.stringify({ positive, check, reused, fault }, null, 2),
  );
});
