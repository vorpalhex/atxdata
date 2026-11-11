import { test, expect } from "bun:test";
import { mkdtemp, writeFile, cp, symlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { state } from "./integrity-state";
import { cityPdf } from "./austin-fixtures";

// Export the actual old producer: never synthesize a schema4 archive by editing SQL.
test("genuine imported4 live admission precedes writer and fetch; imports and cache remain allowed", async () => {
  const base = await mkdtemp(join(process.env.TMPDIR!, "live-admission-"));
  const old = join(base, "producer");
  await mkdir(old);
  const repo =
    process.env.ADMISSION_GIT_ROOT ?? resolve(import.meta.dir, "../../..");
  const archive = Bun.spawnSync([
    "git",
    "-C",
    repo,
    "archive",
    "fceb5f63393123c477cee8e481991dc92ed7d490",
    "programs",
  ]);
  expect(archive.exitCode).toBe(0);
  const tar = Bun.spawnSync(["tar", "-x", "-C", old], {
    stdin: archive.stdout,
  });
  expect(tar.exitCode).toBe(0);
  await symlink(
    resolve(import.meta.dir, "../node_modules"),
    join(old, "programs/county-documents-consume/node_modules"),
  );
  const cli = resolve(import.meta.dir, "../src/cli.ts"),
    oldCli = join(old, "programs/county-documents-consume/src/cli.ts");
  const page =
      "https://www.austintexas.gov/budget-excellence/data-and-insights",
    source = "austin-financial-publications";
  const html = join(base, "seed.html"),
    pdf = join(base, "seed.pdf"),
    log = join(base, "fetch.log"),
    preload = join(base, "preload.ts");
  await writeFile(
    html,
    `<h1>City of Austin</h1><h2>FY 2031</h2><a href="https://services.austintexas.gov/edims/document.cfm?id=123456">Quarterly Financial Report</a>`,
  );
  await writeFile(pdf, cityPdf());
  await writeFile(log, "");
  await writeFile(
    preload,
    `import {appendFileSync} from 'node:fs'; import {mock} from 'bun:test'; const real={...await import(process.env.ADMISSION_ENCODING!)}; mock.module(process.env.ADMISSION_ENCODING!,()=>({...real,rawFetch:async()=>{appendFileSync(${JSON.stringify(log)},'fetch');throw Error('unexpected fetch');}}));`,
  );
  async function invoke(target: string, root: string, args: string[]) {
    const p = Bun.spawn(
      [process.execPath, "--preload", preload, target, ...args, "--root", root],
      {
        env: {
          ...process.env,
          ADMISSION_ENCODING: join(target, "../encoding.ts"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, exit] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { out, err, exit };
  }
  const root = join(base, "old4");
  const produced = await invoke(oldCli, root, [
    "import-page",
    "--source",
    source,
    "--page",
    page,
    "--input",
    html,
    "--origin",
    "authored",
  ]);
  expect(produced.err).toBe("");
  expect(produced.exit).toBe(0);
  const before = await state(root);
  expect((before.logical.archive_schema as any[])[0].version).toBe(4);
  expect((await invoke(cli, root, ["catalog", "--source", source])).exit).toBe(
    0,
  );
  expect(await state(root)).toEqual(before);
  for (const sentinel of [false, true])
    for (const command of ["discover", "collect", "sync"]) {
      const copy = join(base, command + sentinel);
      await cp(root, copy, { recursive: true });
      if (sentinel) await writeFile(join(copy, ".civicclerk.lock"), "sentinel");
      const initial = await state(copy);
      const result = await invoke(cli, copy, [
        command,
        "--source",
        source,
        "--allow-network",
        ...(command === "discover" ? ["--page", page] : ["--limit", "1"]),
      ]);
      expect(result.exit).toBe(1);
      expect(result.err).toMatch(
        /live producing references require new schema5/,
      );
      expect(await state(copy)).toEqual(initial);
    }
  expect(await Bun.file(log).text()).toBe("");
  const rows = JSON.parse(
    (await invoke(cli, root, ["list", "--source", source, "--limit", "1"])).out,
  );
  expect(
    (
      await invoke(cli, root, [
        "import-pdf",
        "--observation",
        rows[0].id,
        "--input",
        pdf,
        "--origin",
        "authored",
      ])
    ).exit,
  ).toBe(0);
  const cached = await state(root);
  expect(
    (
      await invoke(cli, root, [
        "collect",
        "--source",
        source,
        "--limit",
        "1",
        "--allow-network",
      ])
    ).exit,
  ).toBe(0);
  expect(await state(root)).toEqual(cached);
});
