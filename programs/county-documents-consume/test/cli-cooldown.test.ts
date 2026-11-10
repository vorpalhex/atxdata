import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { sources, type Source } from "../src/adapters";

const bodies: Partial<Record<Source, string>> = {
  budgets: '<h2>FY 2030</h2><a href="/tax.pdf">Taxpayer Impact Statement</a>',
  "meeting-archives":
    '<a href="/minutes.pdf">January 5, 2010 Regular Session Minutes</a>',
  "election-documents":
    '<h2>November 3, 2026 Election</h2><a href="/official.pdf">Official Results</a>',
};
function logical(db: Database) {
  const names = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all();
  return Object.fromEntries(
    names.map(({ name }) => [
      name,
      db.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ]),
  );
}
async function nativeCase(source: Source, fault: boolean, bodyMs = 0) {
  const root = await realpath(
      await mkdtemp(join(process.env.TMPDIR!, "native-cooldown-")),
    ),
    starts: number[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.headers.get("x-fixture-source")!),
        robots = url.pathname === "/robots.txt";
      starts.push(Date.now());
      const headers = {
        "content-type": robots ? "text/plain" : "text/html",
        ...(robots
          ? {}
          : bodyMs
            ? {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 1),
              }
            : { "retry-after": "5" }),
      };
      if (robots) return new Response("User-agent: *\nDisallow:", { headers });
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("<main>"));
            if (bodyMs) await Bun.sleep(bodyMs);
            controller.enqueue(
              new TextEncoder().encode(bodies[source] + "</main>"),
            );
            controller.close();
          },
        }),
        { headers },
      );
    },
  });
  try {
    const preload = join(root, "preload.ts"),
      encoding = join(import.meta.dir, "../src/encoding.ts");
    await writeFile(
      preload,
      `import {mock} from 'bun:test';const path=${JSON.stringify(encoding)},actual=await import(path),wire=actual.rawFetch,consumeEncoded=actual.consumeEncoded;mock.module(path,()=>({consumeEncoded,rawFetch:(url,init={})=>{if(new URL(String(url)).hostname!==${JSON.stringify(new URL(sources[source].pages[0]).hostname)})throw Error('fixture authority only');const headers=new Headers(init.headers);headers.set('x-fixture-source',url);return wire('http://127.0.0.1:${server.port}/fixture',{...init,headers})}}));`,
    );
    const argv = [
      process.execPath,
      "--preload",
      preload,
      join(import.meta.dir, "../src/cli.ts"),
      "discover",
      "--root",
      root,
      "--source",
      source,
      "--page",
      sources[source].pages[0],
      "--allow-network",
      "--max-requests",
      "2",
    ];
    const call = async () => {
      const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, exit };
    };
    const first = await call();
    expect(first.exit).toBe(0);
    const db = new Database(join(root, "documents.sqlite"));
    const deadline = db
      .query<{ not_before: number }, []>("SELECT not_before FROM cooldowns")
      .get()!.not_before;
    if (fault) db.run("UPDATE cooldowns SET not_before=0");
    const before = logical(db);
    db.close();
    const count = starts.length;
    const second = await call();
    if (fault) {
      expect(second.exit).toBe(1);
      expect(second.stderr).toMatch(/cooldown/);
      expect(starts).toHaveLength(count);
      const check = new Database(join(root, "documents.sqlite"));
      expect(logical(check)).toEqual(before);
      check.close();
    } else {
      expect(second.exit).toBe(0);
      expect(starts[count]).toBeGreaterThanOrEqual(deadline);
    }
    // Optional external receipts are authored fixture evidence only, never publisher data.
    if (process.env.COOLDOWN_RECEIPTS)
      await writeFile(
        join(
          process.env.COOLDOWN_RECEIPTS,
          `native-${source}-${fault}-${bodyMs}.json`,
        ),
        JSON.stringify(
          {
            source,
            fault,
            bodyMs,
            argv,
            first,
            second,
            deadline,
            starts,
            forbiddenRequests: fault ? starts.length - count : 0,
            unchangedLogicalState: fault,
          },
          null,
          2,
        ),
      );
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}
for (const source of [
  "budgets",
  "meeting-archives",
  "election-documents",
] as const)
  for (const fault of [false, true])
    test(
      `native CLI ${source} retained hold rollback=${fault}`,
      () => nativeCase(source, fault),
      30000,
    );
for (const bodyMs of [100, 2100])
  test(
    `native CLI Reset receipt stable across ${bodyMs} ms body and reopen`,
    () => nativeCase("budgets", false, bodyMs),
    30000,
  );
