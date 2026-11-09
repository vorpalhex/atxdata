import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { item, id } from "./support/selection-fixture";
import { terms } from "../src/rules";

test("native CLI rejects cooldown-only faults before collect/verify/sync and records no fixture calls or writes", async () => {
  const base = await mkdtemp(join(process.env.TMPDIR!, "native-policy-"));
  const preload = join(base, "fixture.ts"),
    calls = join(base, "calls.txt");
  await writeFile(calls, "");
  await writeFile(
    preload,
    `import { appendFileSync } from 'node:fs';import { fixture } from ${JSON.stringify(resolve(import.meta.dir, "support/selection-fixture.ts"))};const f=fixture();Date.now=f.deps.now;Bun.sleep=f.deps.sleep;globalThis.fetch=async(u)=>{appendFileSync(${JSON.stringify(calls)},'request\\n');return f.deps.fetch(u);};`,
  );
  const cli = resolve(import.meta.dir, "../src/cli.ts"),
    receipts = [];
  const invoke = async (args: string[]) => {
    const p = Bun.spawn(
      [process.execPath, "--preload", preload, cli, ...args],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { stdout, stderr, exit };
  };
  for (const value of ["broken", -1, Number.MAX_SAFE_INTEGER + 1, "deleted"]) {
    const root = join(base, String(receipts.length));
    const args = [
      "collect",
      "--source",
      "tnr",
      "--item",
      id,
      "--layer",
      "7",
      "--page-size",
      "4",
      "--archive",
      root,
      "--terms-sha256",
      terms(item).sha256,
    ];
    const positive = await invoke(args);
    expect(positive.exit).toBe(0);
    expect(JSON.parse(positive.stdout).summary.records).toBe(13);
    const db = new Database(join(root, "state.sqlite"));
    if (value === "deleted") db.exec("DELETE FROM cooldown");
    else db.query("UPDATE cooldown SET not_before=?").run(value);
    const snapshot = () =>
      JSON.stringify(
        [
          "cooldown",
          "sources",
          "runs",
          "attempts",
          "acquisition_options",
          "observations",
          "versions",
        ].map((t) => db.query(`SELECT * FROM ${t}`).all()),
      );
    const before = snapshot(),
      beforeCalls = await readFile(calls, "utf8");
    try {
      for (const command of ["collect", "verify", "sync"]) {
        const result = await invoke(
          command === "verify"
            ? ["verify", "--archive", root]
            : [command, ...args.slice(1)],
        );
        expect(result.exit).toBe(1);
        expect(result.stderr).toContain("cooldown");
        receipts.push({
          fault: value,
          command,
          exit: result.exit,
          error: result.stderr.trim(),
        });
      }
      expect(snapshot()).toBe(before);
      expect(await readFile(calls, "utf8")).toBe(beforeCalls);
    } finally {
      db.close();
    }
  }
  await writeFile(
    join(base, "native-policy-receipts.json"),
    JSON.stringify(receipts, null, 2),
  );
});
