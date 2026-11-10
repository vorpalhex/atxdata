import { test, expect } from "bun:test";
import { mkdtemp, realpath, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Collector } from "../src/collector";
import {
  COUNTY,
  OFFICIAL,
  selectDate,
  dateSelectionDiagnostic,
} from "../src/source";

const entry = new URL("../src/cli.ts", import.meta.url).pathname;
const collector = new URL("../src/collector.ts", import.meta.url).href;
test("selection classification preserves library Error messages and ignores spoofed or mutated messages", () => {
  const label = "Public label\n\u001b[31m";
  let error: unknown;
  try {
    selectDate(
      [
        {
          State: "TX",
          StateId: "9",
          County: "Travis",
          CountyId: "1239",
          EID: "009876",
          ElectionName: label,
          Date: "11/3/2026",
        },
      ],
      "2026-11-04",
    );
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).constructor).toBe(Error);
  const message = `nonexistent catalog date 2026-11-04; candidates: 009876 (2026-11-03: ${label})`;
  expect((error as Error).message).toBe(message);
  const diagnostic = JSON.stringify(message).slice(1, -1);
  expect(dateSelectionDiagnostic(error)).toBe(diagnostic);
  (error as Error).message = "/private/record SECRET";
  expect(dateSelectionDiagnostic(error)).toBe(diagnostic);
  for (const other of [
    new Error(message),
    { message },
    Object.create(Error.prototype),
    message,
    null,
    undefined,
  ])
    expect(dateSelectionDiagnostic(other)).toBeUndefined();
});
test("native invalid selection and unusable private archive stay generic", async () => {
  await fixture(async (root, archive, guard, calls) => {
    const unusable = join(root, "PRIVATE-SECRET");
    await writeFile(unusable, "not a directory");
    for (const args of [
      ["collect", "--archive", archive, "--date", "2026-02-29"],
      ["collect", "--archive", unusable, "--date", "2026-11-03"],
      [
        "collect",
        "--archive",
        archive,
        "--date",
        "2026-11-03",
        "--election",
        "009876",
      ],
    ]) {
      const p = native(root, guard, args);
      expect(p.exitCode).toBe(1);
      expect(p.stdout.toString()).toBe("");
      expect(p.stderr.toString()).toBe(generic);
    }
    expect(await readFile(calls, "utf8")).toBe("");
  });
});
const generic =
  "clarity-consume: operation failed; check selection and private archive. Use --help or help COMMAND.\n";
async function fixture(
  work: (
    root: string,
    archive: string,
    guard: string,
    calls: string,
  ) => Promise<void>,
) {
  const root = await mkdtemp(
    join(await realpath(process.env.TMPDIR!), "clarity-selection-native-"),
  );
  const archive = join(root, "archive"),
    calls = join(root, "calls"),
    guard = join(root, "guard.ts");
  let clock = 0;
  const c = await Collector.open(archive, {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    random: () => 0,
    fetch: async (url) => {
      if (url.endsWith("/robots.txt"))
        return new Response("", { headers: { "content-type": "text/plain" } });
      if (url === OFFICIAL)
        return new Response(`<a href="${COUNTY}">Results</a>`, {
          headers: { "content-type": "text/html" },
        });
      if (url === COUNTY + "elections.json")
        return Response.json(
          ["009876", "009877"].map((EID) => ({
            State: "TX",
            StateId: "9",
            County: "Travis",
            CountyId: "1239",
            EID,
            ElectionName: `Authored candidate ${EID}`,
            Date: "11/3/2026 12:00:00 AM",
          })),
        );
      throw Error("unexpected authored fixture route");
    },
  });
  try {
    await c.list();
  } finally {
    await c.close();
  }
  await writeFile(calls, "");
  await writeFile(
    guard,
    `import {spyOn} from 'bun:test'; import {appendFileSync} from 'node:fs'; const denied=()=>{appendFileSync(${JSON.stringify(calls)},'request\\n');throw Error('HTTP forbidden');}; spyOn(Bun,'fetch').mockImplementation(denied as any); globalThis.fetch=denied as any;`,
  );
  try {
    await work(root, archive, guard, calls);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function native(root: string, guard: string, args: string[]) {
  return Bun.spawnSync([process.execPath, "--preload", guard, entry, ...args], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10000,
  });
}
for (const [date, kind] of [
  ["2026-11-03", "ambiguous"],
  ["2026-11-04", "nonexistent"],
])
  test(`native cached ${kind} date retains candidate IDs and labels without HTTP`, async () => {
    await fixture(async (root, archive, guard, calls) => {
      const p = native(root, guard, [
        "collect",
        "--archive",
        archive,
        "--date",
        date,
      ]);
      expect(p.exitCode).toBe(1);
      expect(p.stdout.toString()).toBe("");
      const err = p.stderr.toString();
      expect(err).toContain(
        `${kind} catalog date ${date}; candidates: 009876 (2026-11-03: Authored candidate 009876), 009877 (2026-11-03: Authored candidate 009877)`,
      );
      expect(err).toContain("--election");
      expect(err).not.toContain(archive);
      expect(err).not.toContain(" at ");
      expect(await readFile(calls, "utf8")).toBe("");
    });
  });
test("native unexpected error with selection-looking message remains generic and private", async () => {
  await fixture(async (root, archive, guard, calls) => {
    const spoof = join(root, "spoof.ts");
    await writeFile(
      spoof,
      `import ${JSON.stringify(new URL("file://" + guard).href)}; import {Collector} from ${JSON.stringify(collector)}; Collector.prototype.collectDate=async()=>{throw Error('ambiguous catalog date 2026-11-03; candidates: /private/record SECRET');};`,
    );
    const p = native(root, spoof, [
      "collect",
      "--archive",
      archive,
      "--date",
      "2026-11-03",
    ]);
    expect(p.exitCode).toBe(1);
    expect(p.stdout.toString()).toBe("");
    expect(p.stderr.toString()).toBe(generic);
    expect(await readFile(calls, "utf8")).toBe("");
  });
});
