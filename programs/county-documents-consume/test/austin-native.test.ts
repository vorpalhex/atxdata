import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

import { cityPdf } from "./austin-fixtures";
import { state } from "./integrity-state";

test("native Austin eDIMS acquisition preserves services robots302 and final policy; reuse and refresh", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "austin-native-"));
  const archive = join(root, "archive"),
    pdf = cityPdf(),
    calls: { url: string; at: number }[] = [];
  const page =
    "https://www.austintexas.gov/budget-excellence/data-and-insights";
  const doc = "https://services.austintexas.gov/edims/document.cfm?id=123456";
  let interrupt = false,
    bodyStarted: () => void = () => {},
    mode = "normal";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = req.headers.get("x-authored-url")!;
      calls.push({ url, at: Date.now() });
      expect(req.headers.get("cookie")).toBeNull();
      if (url === "https://services.austintexas.gov/robots.txt") {
        const status = mode === "status" ? 301 : mode === "auth" ? 401 : 302;
        return new Response(
          mode === "challenge"
            ? "access denied: verify you are human"
            : "canonical policy",
          {
            status,
            headers: {
              location:
                mode === "domain"
                  ? "https://other.invalid/robots.txt"
                  : "https://www.austintexas.gov/robots.txt",
              "content-type": "text/plain",
            },
          },
        );
      }
      if (
        url === "https://www.austintexas.gov/robots.txt" &&
        ["multi-hop", "cycle"].includes(mode)
      )
        return new Response("another redirect", {
          status: 302,
          headers: {
            location:
              mode === "cycle"
                ? "https://services.austintexas.gov/robots.txt"
                : "https://other.invalid/robots.txt",
            "content-type": "text/plain",
          },
        });
      if (url === "https://www.austintexas.gov/robots.txt")
        return new Response("User-agent: *\nAllow: /\n", {
          headers: { "content-type": "text/plain" },
        });
      if (url === page)
        return new Response(
          `<h1>City of Austin</h1><h2>FY 2031</h2><a href="${doc}">Quarterly Financial Report</a>`,
          { headers: { "content-type": "text/html" } },
        );
      if (url === doc && interrupt)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(pdf.subarray(0, 32));
              setTimeout(() => bodyStarted(), 200);
            },
          }),
          {
            headers: {
              "content-type": "application/pdf",
              "content-length": String(pdf.length),
            },
          },
        );
      if (url === doc)
        return new Response(pdf, {
          headers: { "content-type": "application/pdf" },
        });
      return new Response("unmapped authored URL", { status: 404 });
    },
  });
  const preload = join(root, "preload.ts");
  const encoding = join(import.meta.dir, "../src/encoding.ts"),
    cli = join(import.meta.dir, "../src/cli.ts");
  await writeFile(
    preload,
    `import {mock} from 'bun:test';const path=${JSON.stringify(encoding)};const original={...await import(path)};mock.module(path,()=>({...original,rawFetch:(url,init={})=>{const headers=new Headers(init.headers);headers.set('x-authored-url',url);return original.rawFetch(${JSON.stringify(server.url.href)},{...init,headers});}}));`,
  );
  let sequence = 0;
  const invoke = async (
    command: string,
    extra: string[] = [],
    target = archive,
    expected = 0,
  ) => {
    const args = [
      process.execPath,
      "--preload",
      preload,
      cli,
      command,
      "--root",
      target,
      "--source",
      "austin-financial-publications",
      ...extra,
    ];
    const child = Bun.spawn(args, {
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await writeFile(
      join(root, String(++sequence) + "-" + command + ".json"),
      JSON.stringify({ args, exit, stdout, stderr }),
    );
    expect(exit).toBe(expected);
    if (expected !== 0) return stderr;
    expect(stderr).toBe("");
    return JSON.parse(stdout);
  };
  try {
    await invoke("discover", ["--page", page, "--allow-network"]);
    await invoke("collect", ["--limit", "1", "--allow-network"]);
    const db = new Database(join(archive, "documents.sqlite"), {
      readonly: true,
    });
    const original = db
      .query<any, []>("SELECT * FROM attempts WHERE status=302")
      .get();
    expect(original.url).toBe("https://services.austintexas.gov/robots.txt");
    expect(original.error).toBeNull();
    const version = db.query<any, []>("SELECT * FROM versions").get();
    expect(version.sha).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(
      Buffer.from(await readFile(join(archive, version.path))).equals(pdf),
    ).toBe(true);
    expect(db.query("SELECT COUNT(*) n FROM robots_bindings").get()).toEqual({
      n: 1,
    });
    db.close();
    const before = calls.length;
    await invoke("collect", ["--limit", "1", "--allow-network"]);
    await invoke("verify", ["--limit", "1"]);
    expect(calls.length).toBe(before);
    await invoke("sync", ["--limit", "1", "--allow-network"]);
    expect(calls.length).toBe(before + 1);
    for (let i = 1; i < calls.length; i++)
      expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(2950);
    for (const [name, sql, category] of [
      ["missing-producer", "DELETE FROM snapshot_producers", /producing/],
      [
        "pdf-headers",
        `UPDATE attempts SET headers='[["content-type","text/html"]]' WHERE kind='pdf'`,
        /producing/,
      ],
      [
        "pdf-url",
        "UPDATE attempts SET url='https://services.austintexas.gov/edims/document.cfm?id=999999' WHERE kind='pdf'",
        /producing/,
      ],
      [
        "page-url",
        "UPDATE attempts SET url='https://www.austintexas.gov/budget-excellence/other-report' WHERE kind='page'",
        /producing/,
      ],
      [
        "edge",
        "UPDATE redirect_edges SET target_url='https://other.invalid/robots.txt'",
        /redirect/,
      ],
      [
        "policy",
        "UPDATE robots_bindings SET final_attempt=redirect_attempt",
        /policy binding/,
      ],
      [
        "edge-spacing",
        "UPDATE attempts SET started=(SELECT a.ended+2999 FROM redirect_edges e JOIN attempts a ON a.id=e.attempt WHERE e.target_attempt=attempts.id) WHERE id IN (SELECT target_attempt FROM redirect_edges)",
        /redirect downstream identity\/pacing/,
      ],
      [
        "metadata",
        "UPDATE snapshot_metadata SET adapter_schema=3",
        /metadata version/,
      ],
      [
        "county",
        "UPDATE observations SET evidence=json_set(evidence,'$.administeringCounty','Travis')",
        /inventory/,
      ],
      [
        "receipt",
        "UPDATE runs SET kind=replace(kind,'transport-work-v1:','transport-work-v0:') WHERE id LIKE 'transport-work-v3:%'",
        /reservation|identity/,
      ],
      [
        "downgrade",
        "UPDATE runs SET id=replace(id,'transport-work-v3:','transport-work-v2:'); UPDATE attempts SET run=replace(run,'transport-work-v3:','transport-work-v2:')",
        /redirect edge original/,
      ],
      ["missing-table", "DROP TABLE robots_bindings", /missing required table/],
    ] as const) {
      const target = join(root, name);
      await cp(archive, target, { recursive: true });
      const fault = new Database(join(target, "documents.sqlite"));
      fault.exec(sql);
      fault.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      fault.close();
      const beforeState = await state(target);
      const bytes = await readFile(join(target, "documents.sqlite")),
        n = calls.length;
      expect(await invoke("verify", ["--limit", "1"], target, 1)).toMatch(
        category,
      );
      expect(calls.length).toBe(n);
      expect(await state(target)).toEqual(beforeState);
      expect(
        (await readFile(join(target, "documents.sqlite"))).equals(bytes),
      ).toBe(true);
    }
    const n = calls.length;
    expect(
      await invoke(
        "collect",
        ["--limit", "1", "--allow-network", "--max-pdf-bytes", "1"],
        archive,
        1,
      ),
    ).toMatch(/budget|limit/);
    expect(calls.length).toBe(n);
    const seed = join(root, "seed.html");
    await writeFile(
      seed,
      `<h2>FY 2031</h2><a href="${doc}">Quarterly Financial Report</a>`,
    );
    const bounded = join(root, "bounded");
    await invoke(
      "import-page",
      ["--page", page, "--input", seed, "--origin", "authored-fixture"],
      bounded,
    );
    const start = calls.length;
    expect(
      await invoke(
        "collect",
        ["--limit", "1", "--allow-network", "--max-requests", "1"],
        bounded,
        1,
      ),
    ).toMatch(/budget/);
    expect(calls.length).toBe(start + 1);
    const stopped = new Database(join(bounded, "documents.sqlite"), {
      readonly: true,
    });
    expect(
      stopped.query<any, []>("SELECT blocked FROM cooldowns").get().blocked,
    ).toMatch(/redirect chain pending/);
    expect(stopped.query("SELECT status,error FROM attempts").get()).toEqual({
      status: 302,
      error: null,
    });
    stopped.close();
    expect(
      await invoke("sync", ["--limit", "1", "--allow-network"], bounded, 1),
    ).toMatch(/stopped/);
    expect(calls.length).toBe(start + 1);
    for (const variant of [
      "domain",
      "status",
      "auth",
      "challenge",
      "multi-hop",
      "cycle",
    ]) {
      mode = variant;
      const target = join(root, "hostile-" + variant);
      await invoke(
        "import-page",
        ["--page", page, "--input", seed, "--origin", "authored-fixture"],
        target,
      );
      const initial = calls.length;
      expect(
        await invoke(
          "collect",
          ["--limit", "1", "--allow-network", "--max-requests", "3"],
          target,
          1,
        ),
      ).toMatch(/redirect|HTTP|challenge/);
      expect(calls.length - initial).toBe(
        ["multi-hop", "cycle"].includes(mode) ? 2 : 1,
      );
      const failed = new Database(join(target, "documents.sqlite"), {
        readonly: true,
      });
      expect(
        failed.query<any, []>("SELECT blocked FROM cooldowns").get().blocked,
      ).not.toBeNull();
      if (mode === "challenge")
        expect(
          failed.query("SELECT COUNT(*) n FROM redirect_edges").get(),
        ).toEqual({ n: 0 });
      failed.close();
      expect(
        await invoke("sync", ["--limit", "1", "--allow-network"], target, 1),
      ).toMatch(/stopped/);
    }
    mode = "normal";
    const tooSmall = join(root, "aggregate-small");
    const aggregateLater = join(root, "aggregate-later");
    await invoke(
      "import-page",
      ["--page", page, "--input", seed, "--origin", "authored-fixture"],
      aggregateLater,
    );
    const aggregateStart = calls.length;
    expect(
      await invoke(
        "collect",
        ["--limit", "1", "--allow-network", "--max-bytes", "3145728"],
        aggregateLater,
        1,
      ),
    ).toMatch(/budget/);
    expect(calls.length).toBe(aggregateStart + 1);
    await invoke(
      "import-page",
      ["--page", page, "--input", seed, "--origin", "authored-fixture"],
      tooSmall,
    );
    const noWire = calls.length;
    expect(
      await invoke(
        "collect",
        ["--limit", "1", "--allow-network", "--max-bytes", "3145727"],
        tooSmall,
        1,
      ),
    ).toMatch(/budget/);
    expect(calls.length).toBe(noWire);
    const interrupted = join(root, "interrupted");
    await cp(archive, interrupted, { recursive: true });
    interrupt = true;
    const arrival = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    const child = Bun.spawn(
      [
        process.execPath,
        "--preload",
        preload,
        cli,
        "sync",
        "--root",
        interrupted,
        "--source",
        "austin-financial-publications",
        "--limit",
        "1",
        "--allow-network",
      ],
      {
        env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await Promise.race([
      arrival,
      Bun.sleep(8000).then(() => {
        throw Error("authored partial response not reached");
      }),
    ]);
    child.kill("SIGKILL");
    await child.exited;
    const partial = new Database(join(interrupted, "documents.sqlite"), {
      readonly: true,
    });
    expect(
      partial
        .query<any, []>(
          "SELECT status,ended,sha FROM attempts ORDER BY rowid DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ status: 200, ended: null, sha: null });
    expect(
      partial.query<any, []>("SELECT blocked FROM cooldowns").get().blocked,
    ).toMatch(/unfinished/);
    partial.close();
    const afterKill = calls.length,
      bytes = await readFile(join(interrupted, "documents.sqlite"));
    expect(
      await invoke("sync", ["--limit", "1", "--allow-network"], interrupted, 1),
    ).toMatch(/EEXIST/);
    expect(calls.length).toBe(afterKill);
    expect(
      (await readFile(join(interrupted, "documents.sqlite"))).equals(bytes),
    ).toBe(true);
    // Explicit test-only retired-owner copy: preserve original lock and all durable evidence.
    const retired = join(root, "interrupted-retired");
    await cp(interrupted, retired, {
      recursive: true,
      filter: (from) => !from.endsWith("/.civicclerk.lock"),
    });
    expect(
      await invoke("sync", ["--limit", "1", "--allow-network"], retired, 1),
    ).toMatch(/stopped/);
    expect(calls.length).toBe(afterKill);
  } finally {
    server.stop(true);
  }
}, 120000);
