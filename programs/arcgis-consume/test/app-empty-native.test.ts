import { test, expect } from "bun:test";
import { createServer, type Socket } from "node:net";
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rename,
  mkdir,
  lstat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
const id = "9".repeat(32);
const item = {
  id,
  title: "Raw representation fixture",
  access: "public",
  type: "Web Mapping Application",
  url: "https://maps.austintexas.gov/OnlyFixture/",
  licenseInfo: "Fixture item terms",
};
const catalogTerms = "Different catalog fixture terms";
function frame(body: string, headers = "", status = "200 OK") {
  return `HTTP/1.1 ${status}\r\nContent-Type: text/plain;charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${headers}Connection: close\r\n\r\n${body}`;
}
async function nativeFixture(
  wire: string,
  mode = "end",
  emptyAt?: string,
  crash?: string,
) {
  const base = await mkdtemp(join(process.env.TMPDIR!, "empty-native-"));
  const root = join(base, "archive"),
    preload = join(base, "fixture.ts"),
    calls = join(base, "calls");
  await writeFile(calls, "");
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => {
      connections++;
      if (mode === "abort") socket.destroy();
      else if (mode === "timeout") socket.write(wire);
      else if (mode === "reset-after") {
        socket.write(wire);
        setTimeout(() => socket.destroy(), 30);
      } else socket.end(wire);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const c = {
    crash,
    store: resolve(import.meta.dir, "../src/store.ts"),
    emptyAt,
    item,
    site: configs.austin.site,
    catalogTerms,
    calls,
    clock: join(base, "clock"),
    target: `http://127.0.0.1:${port}/data`,
  };
  await writeFile(
    preload,
    `import {existsSync,readFileSync,writeFileSync,appendFileSync} from "node:fs";
const c=${JSON.stringify(c)};
if(c.crash){const {Store}=await import(c.store);const checkpoint=Store.prototype.checkpoint;Store.prototype.checkpoint=function(row){if(row.label==="app-data"&&c.crash==="before-checkpoint")process.exit(73);const v=checkpoint.call(this,row);if(row.label==="app-data"&&c.crash==="after-checkpoint")process.exit(73);return v;};const ready=Store.prototype.ready;Store.prototype.ready=function(row){const v=ready.call(this,row);if(row.label==="app-data"&&c.crash==="after-ready")process.exit(73);return v;};const complete=Store.prototype.finishAttempt;Store.prototype.finishAttempt=function(...args){const v=complete.apply(this,args);const row=this.db.query("SELECT label FROM attempts WHERE id=?").get(args[0]);if(row?.label==="app-data"&&c.crash==="after-complete")process.exit(73);return v;};}
const native=globalThis.fetch;const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms===45000?300:ms,...args);const timeout=AbortSignal.timeout;AbortSignal.timeout=(ms)=>timeout(Math.min(ms,300));let now=existsSync(c.clock)?Number(readFileSync(c.clock,"utf8")):0;Date.now=()=>now;Bun.sleep=async(ms)=>{now+=Number(ms);writeFileSync(c.clock,String(now))};process.on("exit",()=>Bun.gc(true));
globalThis.fetch=async(url,init)=>{appendFileSync(c.calls,String(url)+"\\n");const u=new URL(url);if(u.origin!=="https://www.arcgis.com")throw Error("unexpected fixture authority");const route=u.pathname==="/robots.txt"?"robots":u.pathname.endsWith(c.site+"/data")?"site-data":u.pathname.endsWith(c.site)?"site-item":u.pathname.endsWith("/search")?"catalog":u.pathname.endsWith(c.item.id)?"app-item":"app-data";if(c.emptyAt===route)return native(c.target,init);if(u.pathname==="/robots.txt")return new Response("User-agent: *\\nAllow: /\\n");if(u.pathname.endsWith("/search"))return Response.json({total:1,nextStart:-1,results:[c.item]});if(u.pathname.endsWith(c.site+"/data"))return Response.json({catalogV2:{scopes:{item:{filters:[{predicates:[{group:["a".repeat(32)]}]}]}}}});if(u.pathname.endsWith(c.site))return Response.json({...c.item,id:c.site,licenseInfo:c.catalogTerms});if(u.pathname.endsWith(c.item.id+"/data"))return native(c.target,init);if(u.pathname.endsWith(c.item.id))return Response.json(c.item);throw Error("unexpected fixture route")};`,
  );
  await writeFile(
    join(base, "deny.ts"),
    'globalThis.fetch=async()=>{throw Error("offline fixture forbids fetch")};process.on("exit",()=>Bun.gc(true));',
  );
  const args = [
    "inspect-app",
    "--source",
    "austin",
    "--item",
    id,
    "--archive",
    root,
    "--terms-sha256",
    terms(item).sha256,
    "--catalog-terms-sha256",
    terms({ licenseInfo: catalogTerms }).sha256,
    "--max-requests",
    "16",
  ];
  const invoke = async (
    argv = args,
    v2 = false,
    cli = resolve(import.meta.dir, "../src/cli.ts"),
    online = true,
  ) => {
    const p = Bun.spawn(
      [
        process.execPath,
        "--preload",
        online ? preload : join(base, "deny.ts"),
        cli,
        ...argv,
        ...(v2 ? ["--app-data-format", "json-or-empty-v2"] : []),
      ],
      {
        env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return {
      out: await new Response(p.stdout).text(),
      err: await new Response(p.stderr).text(),
      exit: await p.exited,
    };
  };
  return {
    base,
    root,
    args,
    calls,
    invoke,
    get connections() {
      return connections;
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
test("genuine v1 default keeps complete-zero unadmitted and held", async () => {
  const f = await nativeFixture(frame(""));
  try {
    const r = await f.invoke();
    expect(f.connections).toBe(1);
    expect(r.exit).toBe(1);
    expect(r.err).toContain("manual review");
    const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
    expect(
      db
        .query("SELECT COUNT(*) n FROM observations WHERE label=?")
        .get("app-data"),
    ).toEqual({ n: 0 });
    expect(
      (
        db.query("SELECT not_before FROM cooldown").get() as {
          not_before: number;
        }
      ).not_before,
    ).toBe(Number.MAX_SAFE_INTEGER);
    db.close();
  } finally {
    await f.close();
  }
});
for (const [name, wire] of [
  ["length0", frame("")],
  [
    "chunked0",
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain;charset=utf-8\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n",
  ],
])
  test(
    "v2 native complete zero " + name + " has exact ready receipt",
    async () => {
      const f = await nativeFixture(wire!);
      try {
        const r = await f.invoke(f.args, true);
        expect(r.err).toBe("");
        expect(r.exit).toBe(0);
        const result = JSON.parse(r.out);
        expect(result.summary).toMatchObject({
          mode: "app-metadata-v2",
          receiptVersion: 2,
          appDataFormat: "json-or-empty-v2",
          outcome: "raw-empty",
          representation: "empty-body",
          metadataOnly: true,
          wrapperResolved: false,
          acquiredFeatures: false,
          acquiredFiles: false,
        });
        expect(result.summary.records).toBeUndefined();
        expect(f.connections).toBe(1);
        const db = new Database(join(f.root, "state.sqlite"), {
          readonly: true,
        });
        const row = db
          .query("SELECT * FROM observations WHERE run=? AND label=?")
          .get(result.run, "app-data") as {
          status: string;
          bytes: number;
          sha256: string;
          path: string;
        };
        expect(row.status).toBe("ready");
        expect(row.bytes).toBe(0);
        expect(row.sha256).toBe(createHash("sha256").update("").digest("hex"));
        expect((await readFile(join(f.root, row.path))).length).toBe(0);
        expect(
          db
            .query("SELECT status,bytes,error FROM attempts WHERE id=?")
            .get(row.path.replace(/\.body$/, "")),
        ).toEqual({ status: 200, bytes: 0, error: null });
        db.close();
        const check = await f.invoke(
          ["verify", "--archive", f.root],
          false,
          undefined,
          false,
        );
        expect(check.err).toBe("");
        expect(check.exit).toBe(0);
        const reused = await f.invoke(f.args, true, undefined, false);
        expect(reused.exit).toBe(0);
        expect(JSON.parse(reused.out).reused).toBe(true);
        expect(f.connections).toBe(1);
      } finally {
        await f.close();
      }
    },
  );

for (const [name, body, outcome] of [
  ["null", "null", "empty"],
  ["string-empty", JSON.stringify(""), "empty"],
  ["object-empty", "{}", "empty"],
  ["array-empty", "[]", "empty"],
  ["scalar", "42", "unsupported"],
  ["object", JSON.stringify({ webmap: "a".repeat(32) }), "unsupported"],
  ["array", "[1,2]", "unsupported"],
  ["error", JSON.stringify({ error: { code: 400 } }), "error"],
])
  test("v2 parsed JSON remains distinct from raw-empty " + name, async () => {
    const f = await nativeFixture(frame(body!));
    try {
      const r = await f.invoke(f.args, true);
      expect(r.err).toBe("");
      expect(r.exit).toBe(0);
      const result = JSON.parse(r.out);
      expect(result.summary).toMatchObject({ representation: "json", outcome });
      const row = result.summary.receipts.find(
        (o: { label: string }) => o.label === "app-data",
      );
      expect(
        (await readFile(join(f.root, row.attempt + ".body"))).toString(),
      ).toBe(body!);
      expect(f.connections).toBe(1);
    } finally {
      await f.close();
    }
  });
const negativeFrames: Array<[string, string, string?]> = [
  [
    "malformed-media",
    "HTTP/1.1 200 OK\r\nContent-Type: text /plain\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  ],
  [
    "positive-length-zero",
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain;charset=utf-8\r\nContent-Length: 10\r\nConnection: close\r\n\r\n",
  ],
  [
    "short-nonempty",
    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 12\r\nConnection: close\r\n\r\n{}",
  ],
  [
    "unterminated-chunks",
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain;charset=utf-8\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n1\r\nx\r\n",
  ],
  ["abort", "", "abort"],
  [
    "abort-after-bytes",
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain;charset=utf-8\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n1\r\n{\r\n",
    "reset-after",
  ],
  [
    "timeout",
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain;charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n",
    "timeout",
  ],
  ["malformed", frame("{")],
  ["whitespace", frame(" ")],
  ["401", frame("", "", "401 Unauthorized")],
  ["403", frame("", "", "403 Forbidden")],
  [
    "redirect",
    frame("", "Location: https://example.invalid/denied\r\n", "302 Found"),
  ],
  ["204", frame("", "", "204 No Content")],
  ["206", frame("", "", "206 Partial Content")],
  ["201", frame("", "", "201 Created")],
  ["auth-header", frame("", "WWW-Authenticate: Basic\r\n")],
  ["challenge", frame("", "Cf-Mitigated: challenge\r\n")],
  [
    "html",
    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  ],
  ["encoding", frame("", "Content-Encoding: gzip\r\n")],
  [
    "unframed",
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain;charset=utf-8\r\nConnection: close\r\n\r\n",
  ],
  [
    "malformed-length",
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain;charset=utf-8\r\nContent-Length: bad\r\nConnection: close\r\n\r\n",
  ],
  ["conflicting-framing", frame("", "Transfer-Encoding: chunked\r\n")],
];
for (const [name, wire, mode] of negativeFrames)
  test(
    "v2 native refuses nonadmitted wire/header " + name,
    async () => {
      const f = await nativeFixture(wire, mode);
      try {
        const r = await f.invoke(f.args, true);
        expect(r.exit).toBe(1);
        expect(f.connections).toBe(1);
        const db = new Database(join(f.root, "state.sqlite"), {
          readonly: true,
        });
        expect(
          db
            .query("SELECT COUNT(*) n FROM observations WHERE label=?")
            .get("app-data"),
        ).toEqual({ n: 0 });
        expect(
          db
            .query("SELECT COUNT(*) n FROM runs WHERE status=?")
            .get("succeeded"),
        ).toEqual({ n: 0 });
        db.close();
      } finally {
        await f.close();
      }
    },
    10000,
  );
for (const at of ["robots", "site-item", "site-data", "catalog", "app-item"])
  test("v2 does not broaden empty " + at + " admission", async () => {
    const f = await nativeFixture(frame(""), "end", at);
    try {
      const r = await f.invoke(f.args, true);
      expect(r.exit).toBe(1);
      expect(f.connections).toBe(1);
      const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
      expect(
        db
          .query("SELECT COUNT(*) n FROM observations WHERE label=?")
          .get("app-data"),
      ).toEqual({ n: 0 });
      db.close();
    } finally {
      await f.close();
    }
  });

test("genuine untouched ad0 successful v1 producer replays without marker rewriting", async () => {
  const cli = process.env.ARCGIS_APP_V1_PRODUCER;
  expect(cli).toBeTruthy();
  const f = await nativeFixture(frame("{}"));
  try {
    const old = await f.invoke(f.args, false, cli);
    expect(old.exit).toBe(0);
    expect(JSON.parse(old.out).summary).toMatchObject({
      mode: "app-metadata-v1",
      receiptVersion: 1,
      outcome: "empty",
    });
    const before = await logicalSnapshot(f.root);
    const physicalBefore = await rootSnapshot(f.root);
    const check = await f.invoke(
      ["verify", "--archive", f.root],
      false,
      undefined,
      false,
    );
    expect(check.err).toBe("");
    expect(check.exit).toBe(0);
    const reused = await f.invoke(f.args, false, undefined, false);
    expect(reused.exit).toBe(0);
    expect(JSON.parse(reused.out).reused).toBe(true);
    expect(f.connections).toBe(1);
    expect(await logicalSnapshot(f.root)).toEqual(before);
    expect(await rootSnapshot(f.root)).toEqual(physicalBefore);
  } finally {
    await f.close();
  }
});
async function rootSnapshot(root: string) {
  const out: Record<string, string> = {};
  for (const n of (await readdir(root)).sort()) {
    if (n.endsWith("-shm")) continue;
    out[n] = createHash("sha256")
      .update(await readFile(join(root, n)))
      .digest("hex");
  }
  return out;
}
test("v2 format native invalid/source/command/duplicate guards are pre-writer", async () => {
  const f = await nativeFixture(frame(""));
  const absent = join(f.base, "absent");
  try {
    for (const change of [
      [
        "rules",
        "--source",
        "austin",
        "--item",
        id,
        "--app-data-format",
        "json-or-empty-v2",
      ],
      [
        "inspect-app",
        "--source",
        "water",
        "--item",
        id,
        "--app-data-format",
        "json-or-empty-v2",
      ],
      [
        "inspect-app",
        "--source",
        "austin",
        "--item",
        id,
        "--app-data-format",
        "json-or-empty-v3",
      ],
      [
        "inspect-app",
        "--source",
        "austin",
        "--app-data-format",
        "json-or-empty-v2",
      ],
      [
        "inspect-app",
        "--source",
        "austin",
        "--item",
        id,
        "--app-data-format",
        "json-or-empty-v2",
        "--app-data-format",
        "json-or-empty-v2",
      ],
    ]) {
      const r = await f.invoke([
        ...change,
        "--archive",
        absent,
        "--terms-sha256",
        "a".repeat(64),
        "--catalog-terms-sha256",
        "b".repeat(64),
      ]);
      expect(r.exit).toBe(1);
      expect(await readdir(f.base)).not.toContain("absent");
    }
    for (const info of ["--help", "--version"]) {
      const r = await f.invoke([
        "inspect-app",
        "--source",
        "invalid",
        "--archive",
        "/dev/null",
        "--app-data-format",
        "invalid",
        info,
      ]);
      expect(r.exit).toBe(0);
      expect(r.err).toBe("");
    }
    expect(f.connections).toBe(0);
    expect(await readFile(f.calls, "utf8")).toBe("");
  } finally {
    await f.close();
  }
});

async function logicalSnapshot(root: string) {
  const db = new Database(join(root, "state.sqlite"), { readonly: true });
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type=char(116,97,98,108,101) ORDER BY name",
    )
    .all();
  const logical = tables.map(({ name }) => [
    name,
    db.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
  ]);
  db.close();
  Bun.gc(true);
  const files: Record<string, string> = {};
  for (const n of (await readdir(root)).sort())
    if (!n.startsWith("state.sqlite"))
      files[n] = createHash("sha256")
        .update(await readFile(join(root, n)))
        .digest("hex");
  return { logical, files };
}
async function fenced(
  f: Awaited<ReturnType<typeof nativeFixture>>,
  args: string[],
) {
  const preload = join(f.base, "fence.ts");
  await writeFile(
    preload,
    `import {Archive} from ${JSON.stringify(resolve(import.meta.dir, "../src/archive.ts"))};Archive.open=async()=>{throw Error("WRITER_FENCE")};globalThis.fetch=async()=>{throw Error("FETCH_FENCE")};`,
  );
  const p = Bun.spawn(
    [
      process.execPath,
      "--preload",
      preload,
      resolve(import.meta.dir, "../src/cli.ts"),
      ...args,
    ],
    {
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    out: await new Response(p.stdout).text(),
    err: await new Response(p.stderr).text(),
    exit: await p.exited,
  };
}
for (const fault of [
  "missing-observation",
  "selector",
  "missing-mode",
  "missing-version",
  "missing-format",
  "missing-options",
  "summary-deleted",
  "summary-v1",
  "summary-format",
  "summary-representation",
  "summary-source",
  "missing-data-receipt",
  "joint-downgrade",
  "source-key",
  "intent-source",
  "attempt-path",
  "attempt-url",
  "attempt-label",
  "attempt-status",
  "attempt-error",
  "attempt-unfinished",
  "attempt-bytes",
  "attempt-headers",
  "observation-sha",
  "observation-bytes",
  "pending",
  "pending-path",
  "body-corrupt",
])
  test(
    "v2 pre-writer replay rejects " + fault + " with no fallback/mutation",
    async () => {
      const f = await nativeFixture(frame(""));
      try {
        const good = await f.invoke(f.args, true);
        expect(good.exit).toBe(0);
        const run = JSON.parse(good.out).run;
        const db = new Database(join(f.root, "state.sqlite"));
        const s = JSON.parse(
          (
            db
              .query("SELECT options FROM acquisition_options WHERE run=?")
              .get(run) as { options: string }
          ).options,
        );
        const r = JSON.parse(
          (
            db.query("SELECT summary FROM runs WHERE id=?").get(run) as {
              summary: string;
            }
          ).summary,
        );
        const row = db
          .query("SELECT path FROM observations WHERE run=? AND label=?")
          .get(run, "app-data") as { path: string };
        if (fault === "selector") s.selection.layer = 0;
        if (fault === "missing-mode") delete s.mode;
        if (fault === "missing-version") delete s.receiptVersion;
        if (fault === "missing-format") delete s.appDataFormat;
        if (fault === "intent-source") s.source = "voter";
        if (fault === "summary-v1") r.receiptVersion = 1;
        if (fault === "summary-format") delete r.appDataFormat;
        if (fault === "summary-representation") delete r.representation;
        if (fault === "summary-source") r.source = "voter";
        if (fault === "missing-data-receipt") delete r.appDataReceipt;
        if (fault === "joint-downgrade") {
          s.mode = "app-metadata-v1";
          s.receiptVersion = 1;
          delete s.appDataFormat;
          r.mode = "app-metadata-v1";
          r.receiptVersion = 1;
          delete r.appDataFormat;
          delete r.representation;
          delete r.appDataReceipt;
        }
        db.query("UPDATE acquisition_options SET options=? WHERE run=?").run(
          JSON.stringify(s),
          run,
        );
        db.query("UPDATE runs SET summary=? WHERE id=?").run(
          JSON.stringify(r),
          run,
        );
        if (fault === "missing-options")
          db.query("DELETE FROM acquisition_options WHERE run=?").run(run);
        if (fault === "missing-observation")
          db.query("DELETE FROM observations WHERE run=? AND label=?").run(
            run,
            "app-data",
          );
        if (fault === "summary-deleted")
          db.query("UPDATE runs SET summary=NULL WHERE id=?").run(run);
        if (fault === "source-key")
          db.query("UPDATE runs SET source=? WHERE id=?").run(
            "austin:" + id + ":app-metadata-v1",
            run,
          );
        if (fault === "attempt-path") {
          const older = db
            .query("SELECT path FROM observations WHERE run=? AND label=?")
            .get(run, "app-item") as { path: string };
          db.query(
            "UPDATE observations SET path=? WHERE run=? AND label=?",
          ).run(older.path, run, "app-data");
        }
        const change = (field: string, value: unknown) =>
          db
            .query(`UPDATE attempts SET ${field}=? WHERE run=? AND label=?`)
            .run(value as string, run, "app-data");
        if (fault === "attempt-url")
          change("url", "https://www.arcgis.com/wrong");
        if (fault === "attempt-status") change("status", 206);
        if (fault === "attempt-error")
          change("error", "JSON Parse error: Unexpected EOF");
        if (fault === "attempt-unfinished") change("finished", null);
        if (fault === "attempt-bytes") change("bytes", 1);
        if (fault === "attempt-headers")
          change(
            "headers",
            JSON.stringify({
              "content-type": "text/html",
              "content-length": "0",
            }),
          );
        if (fault === "attempt-label") change("label", "other-label");
        if (fault === "observation-sha")
          db.query(
            "UPDATE observations SET sha256=? WHERE run=? AND label=?",
          ).run("a".repeat(64), run, "app-data");
        if (fault === "observation-bytes")
          db.query(
            "UPDATE observations SET bytes=1 WHERE run=? AND label=?",
          ).run(run, "app-data");
        if (fault === "pending" || fault === "pending-path")
          db.query(
            "UPDATE observations SET status=? WHERE run=? AND label=?",
          ).run("pending", run, "app-data");
        db.close();
        Bun.gc(true);
        if (fault === "body-corrupt")
          await writeFile(join(f.root, row.path), " ");
        if (fault === "pending-path")
          await rename(
            join(f.root, row.path),
            join(f.root, row.path + ".pending"),
          );
        const before = await rootSnapshot(f.root),
          calls = await readFile(f.calls, "utf8");
        const bad = await fenced(f, ["verify", "--archive", f.root]);
        expect(bad.exit).toBe(1);
        expect(bad.err).not.toContain("FENCE");
        expect(await rootSnapshot(f.root)).toEqual(before);
        expect(await readFile(f.calls, "utf8")).toBe(calls);
        expect(f.connections).toBe(1);
      } finally {
        await f.close();
      }
    },
  );

for (const stage of [
  "before-checkpoint",
  "after-checkpoint",
  "after-ready",
  "after-complete",
])
  test(
    "native v2 crash boundary " + stage + " has no premature success receipt",
    async () => {
      const f = await nativeFixture(frame(""), "end", undefined, stage);
      try {
        const result = await f.invoke(f.args, true);
        expect(result.exit).toBe(73);
        expect(f.connections).toBe(1);
        const db = new Database(join(f.root, "state.sqlite"), {
          readonly: true,
        });
        const run = db
          .query("SELECT id,status,summary FROM runs WHERE command=?")
          .get("inspect-app") as {
          id: string;
          status: string;
          summary: string | null;
        };
        expect(run.summary).toBeNull();
        expect(run.status).toBe("running");
        const observation = db
          .query("SELECT status FROM observations WHERE run=? AND label=?")
          .get(run.id, "app-data") as { status: string } | null;
        if (stage === "before-checkpoint") expect(observation).toBeNull();
        else
          expect(observation?.status).toBe(
            stage === "after-checkpoint" ? "pending" : "ready",
          );
        db.close();
        Bun.gc(true);
        const before = await rootSnapshot(f.root);
        const refused = await fenced(f, ["verify", "--archive", f.root]);
        expect(refused.exit).toBe(1);
        expect(refused.err).toContain("locked");
        expect(refused.err).not.toContain("FENCE");
        expect(await rootSnapshot(f.root)).toEqual(before);
      } finally {
        await f.close();
      }
    },
  );

test("v2 informational invalid configuration leaves genuinely cold HOME empty", async () => {
  const f = await nativeFixture(frame(""));
  try {
    for (const info of ["--help", "--version"]) {
      const home = join(f.base, "home" + info);
      await mkdir(home);
      const p = Bun.spawn(
        [
          process.execPath,
          "--preload",
          join(f.base, "deny.ts"),
          resolve(import.meta.dir, "../src/cli.ts"),
          "inspect-app",
          "--source",
          "invalid",
          "--archive",
          "/dev/null",
          "--app-data-format",
          "invalid",
          info,
        ],
        {
          cwd: home,
          env: {
            ...process.env,
            HOME: home,
            XDG_CONFIG_HOME: home,
            BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(await p.exited).toBe(0);
      expect(await new Response(p.stderr).text()).toBe("");
      expect(await new Response(p.stdout).text()).toContain(
        info === "--version" ? "0.1.0" : "--app-data-format",
      );
      expect(await readdir(home)).toEqual([]);
    }
    expect(f.connections).toBe(0);
  } finally {
    await f.close();
  }
});

for (const [body, outcome] of [
  ["null", "item-unavailable"],
  ["[]", "item-unavailable"],
  [JSON.stringify({ error: { code: 400 } }), "item-error"],
])
  test(
    "v2 completed negative app item requires no app-data receipt " + body,
    async () => {
      const f = await nativeFixture(frame(body!), "end", "app-item");
      try {
        const r = await f.invoke(f.args, true);
        expect(r.err).toBe("");
        expect(r.exit).toBe(0);
        expect(JSON.parse(r.out).summary).toMatchObject({
          representation: "not-requested",
          outcome,
          receiptVersion: 2,
        });
        expect(f.connections).toBe(1);
        expect(
          (
            await f.invoke(
              ["verify", "--archive", f.root],
              false,
              undefined,
              false,
            )
          ).exit,
        ).toBe(0);
        expect(f.connections).toBe(1);
      } finally {
        await f.close();
      }
    },
  );

test("rules app-only item-before keeps strict JSON rather than v2 empty admission", async () => {
  const f = await nativeFixture(frame(""), "end", "app-item");
  try {
    const result = await f.invoke([
      "rules",
      "--app-only",
      "--source",
      "austin",
      "--item",
      id,
      "--archive",
      f.root,
      "--max-requests",
      "16",
    ]);
    expect(result.exit).toBe(1);
    expect(f.connections).toBe(1);
    const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
    expect(
      db
        .query("SELECT COUNT(*) n FROM observations WHERE label=?")
        .get("item-before"),
    ).toEqual({ n: 0 });
    expect(
      db
        .query("SELECT COUNT(*) n FROM observations WHERE label=?")
        .get("app-data"),
    ).toEqual({ n: 0 });
    db.close();
  } finally {
    await f.close();
  }
});
