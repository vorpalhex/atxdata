import { identityAppData, appRequestDependencies } from "../src/app-encoding";
import { itemUrl } from "../src/sources";
import type { Dependencies } from "../src/archive";
import { test, expect } from "bun:test";
import { createServer } from "node:net";
import { gzipSync } from "node:zlib";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
const id = "abcdef0123456789abcdef0123456789";
const item = {
  id,
  title: "Encoding fixture",
  type: "Web Mapping Application",
  access: "public",
  url: "https://example.invalid/not-followed",
  licenseInfo: "Item fixture terms",
};
const site = {
  ...item,
  id: configs.austin.site,
  licenseInfo: "Distinct catalog terms",
};
async function fixture(mode: string) {
  const base = await mkdtemp(join(process.env.TMPDIR!, "encoding-")),
    root = join(base, "archive"),
    wire: Array<{
      data: boolean;
      identity: boolean;
      gzip: boolean;
      ua: boolean;
      encoded: number;
    }> = [];
  const server = createServer((socket) => {
    let text = "";
    socket.on("data", (chunk) => {
      text += chunk;
      if (!text.includes("\r\n\r\n")) return;
      socket.removeAllListeners("data");
      const lines = text.split("\r\n"),
        url = new URL(lines[0]!.split(" ")[1]!, "http://localhost"),
        headers = new Headers();
      for (const l of lines.slice(1)) {
        const i = l.indexOf(":");
        if (i > 0) headers.set(l.slice(0, i), l.slice(i + 1).trim());
      }
      const data = url.pathname.endsWith(id + "/data"),
        identity = headers.get("accept-encoding") === "identity";
      let body: Buffer,
        type = "application/json",
        encoding = "";
      if (data) {
        const compressed = mode !== "plain" && (mode !== "honor" || !identity);
        body = compressed
          ? gzipSync(Buffer.from(mode === "nonempty" ? "{}" : ""))
          : Buffer.alloc(0);
        if (compressed) encoding = "Content-Encoding: gzip\r\n";
        type = "text/plain;charset=utf-8";
      } else if (url.pathname === "/robots.txt") {
        body = Buffer.from("User-agent: *\nAllow: /\n");
        type = "text/plain";
      } else if (url.pathname.endsWith("/search"))
        body = Buffer.from(
          JSON.stringify({ total: 1, nextStart: -1, results: [item] }),
        );
      else if (url.pathname.endsWith(site.id + "/data"))
        body = Buffer.from(
          JSON.stringify({
            catalogV2: {
              scopes: {
                item: {
                  filters: [{ predicates: [{ group: ["a".repeat(32)] }] }],
                },
              },
            },
          }),
        );
      else if (url.pathname.endsWith(site.id))
        body = Buffer.from(JSON.stringify(site));
      else if (url.pathname.endsWith(id))
        body = Buffer.from(JSON.stringify(item));
      else throw Error("unexpected fixture route");
      wire.push({
        data,
        identity,
        gzip: encoding !== "",
        ua: headers.get("user-agent") === "atxdata-arcgis/0.1",
        encoded: body.length,
      });
      const payload = body.length
        ? Buffer.concat([
            Buffer.from(body.length.toString(16) + "\r\n"),
            body,
            Buffer.from("\r\n0\r\n\r\n"),
          ])
        : Buffer.from("0\r\n\r\n");
      socket.end(
        Buffer.concat([
          Buffer.from(
            "HTTP/1.1 200 OK\r\nContent-Type: " +
              type +
              "\r\nTransfer-Encoding: chunked\r\n" +
              encoding +
              "Connection: close\r\n\r\n",
          ),
          payload,
        ]),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const preload = join(base, "preload.ts");
  await writeFile(
    preload,
    `import {readFileSync,writeFileSync,existsSync} from "node:fs";const clock=${JSON.stringify(join(base, "clock"))};let now=existsSync(clock)?Number(readFileSync(clock,"utf8")):0;Date.now=()=>now;Bun.sleep=async(ms)=>{now+=Number(ms);writeFileSync(clock,String(now))};const native=globalThis.fetch;globalThis.fetch=(url,init)=>{const u=new URL(url);if(u.origin!=="https://www.arcgis.com")throw Error("fixture origin");return native("http://127.0.0.1:${port}"+u.pathname+u.search,init)};process.on("exit",()=>Bun.gc(true));`,
  );
  const deny = join(base, "deny.ts");
  await writeFile(
    deny,
    `globalThis.fetch=()=>{throw Error("offline fetch forbidden")};process.on("exit",()=>Bun.gc(true));`,
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
    terms(site).sha256,
    "--max-requests",
    "6",
    "--max-pages",
    "1",
  ];
  async function invoke(
    argv = args,
    v2 = true,
    cli = resolve(import.meta.dir, "../src/cli.ts"),
    online = true,
  ) {
    const p = Bun.spawn(
      [
        process.execPath,
        "--preload",
        online ? preload : deny,
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
    const [out, err, exit] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { out, err, exit };
  }
  return {
    base,
    root,
    wire,
    args,
    invoke,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
test("standalone explicit v2 requests identity and honors plain empty", async () => {
  const f = await fixture("honor");
  try {
    const r = await f.invoke();
    expect(f.wire.length).toBe(5);
    expect(f.wire.every((w) => w.ua)).toBe(true);
    expect(f.wire.filter((w) => !w.data).every((w) => !w.identity)).toBe(true);
    expect(f.wire.find((w) => w.data)?.identity).toBe(true);
    expect(r.err).toBe("");
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.out).summary).toMatchObject({
      representation: "empty-body",
      outcome: "raw-empty",
      receiptVersion: 2,
    });
  } finally {
    await f.close();
  }
}, 15000);

for (const [mode, v2, success] of [
  ["ignored", true, false],
  ["nonempty", true, true],
  ["honor", false, false],
] as const)
  test(
    "native encoding contrast " + mode + " v2=" + v2,
    async () => {
      const f = await fixture(mode);
      try {
        const r = await f.invoke(f.args, v2);
        expect(f.wire.length).toBe(5);
        const w = f.wire.find((w) => w.data)!;
        expect(w.identity).toBe(v2);
        expect(w.gzip).toBe(true);
        expect(w.encoded).toBe(mode === "nonempty" ? 22 : 20);
        expect(r.exit).toBe(success ? 0 : 1);
        const db = new Database(join(f.root, "state.sqlite"), {
          readonly: true,
        });
        expect(
          db
            .query("SELECT COUNT(*) n FROM observations WHERE label=?")
            .get("app-data"),
        ).toEqual({ n: success ? 1 : 0 });
        if (success)
          expect(JSON.parse(r.out).summary).toMatchObject({
            representation: "json",
            outcome: "empty",
          });
        else
          expect(db.query("SELECT not_before FROM cooldown").get()).toEqual({
            not_before: Number.MAX_SAFE_INTEGER,
          });
        db.close();
      } finally {
        await f.close();
      }
    },
    15000,
  );
test("decorator preserves exact promise/response/signal and caller headers", async () => {
  const response = new Response("{}"),
    promise = Promise.resolve(response),
    signal = new AbortController().signal,
    headers = new Headers({
      "Accept-Encoding": "gzip",
      "User-Agent": "atxdata-arcgis/0.1",
      Accept: "application/json",
      "X-Fixture": "keep",
    }),
    init: RequestInit = { signal, headers, method: "GET", redirect: "manual" };
  let seen: RequestInit | undefined;
  const next: Dependencies["fetch"] = (url, options) => {
    expect(url).toBe(itemUrl(id, true));
    seen = options;
    return promise;
  };
  const wrapped = identityAppData(next, itemUrl(id, true));
  expect(wrapped(itemUrl(id, true), init)).toBe(promise);
  expect(await promise).toBe(response);
  expect(seen?.signal).toBe(signal);
  expect(seen?.method).toBe("GET");
  expect(seen?.redirect).toBe("manual");
  expect(new Headers(seen?.headers).get("accept-encoding")).toBe("identity");
  expect(new Headers(seen?.headers).get("user-agent")).toBe(
    "atxdata-arcgis/0.1",
  );
  expect(new Headers(seen?.headers).get("accept")).toBe("application/json");
  expect(new Headers(seen?.headers).get("x-fixture")).toBe("keep");
  expect(headers.get("accept-encoding")).toBe("gzip");
  expect(init.headers).toBe(headers);
});
for (const url of [
  itemUrl(id),
  itemUrl("f".repeat(32), true),
  itemUrl(id, true) + "&alias=1",
  itemUrl(id, true).replace("www.arcgis.com", "example.invalid"),
  "https://www.arcgis.com/robots.txt",
])
  test("literal unmatched pass-through " + url, () => {
    const init = { headers: { Accept: "application/json" } },
      promise = Promise.resolve(new Response());
    const wrapped = identityAppData(
      (u, i) => {
        expect(u).toBe(url);
        expect(i).toBe(init);
        return promise;
      },
      itemUrl(id, true),
    );
    expect(wrapped(url, init)).toBe(promise);
  });
test("fetch errors preserve thrown and rejected identity", async () => {
  const error = Error("fixture"),
    exact = itemUrl(id, true);
  expect(() =>
    identityAppData(() => {
      throw error;
    }, exact)(exact, {}),
  ).toThrow(error);
  const rejection = Promise.reject(error);
  const p = identityAppData(() => rejection, exact)(exact, {});
  expect(p).toBe(rejection);
  await expect(p).rejects.toBe(error);
});
test("composition exact scope and other dependency identity", () => {
  const deps = {
    now: () => 1,
    sleep: async () => {},
    random: () => 0,
    fetch: () => Promise.resolve(new Response()),
  };
  for (const options of [
    {
      command: "rules",
      source: "austin",
      appDataFormat: "json-or-empty-v2",
      selection: { item: id },
    },
    {
      command: "inspect-app",
      source: "water",
      appDataFormat: "json-or-empty-v2",
      selection: { item: id },
    },
    { command: "inspect-app", source: "austin", selection: { item: id } },
    { command: "verify", source: "austin" },
  ])
    expect(appRequestDependencies(options, deps)).toBe(deps);
  const result = appRequestDependencies(
    {
      command: "inspect-app",
      source: "austin",
      appDataFormat: "json-or-empty-v2",
      selection: { item: id },
    },
    deps,
  );
  expect(result.now).toBe(deps.now);
  expect(result.sleep).toBe(deps.sleep);
  expect(result.random).toBe(deps.random);
  expect(result.fetch).not.toBe(deps.fetch);
});
for (const mode of ["plain", "nonempty"])
  test.skipIf(!process.env.ARCGIS_APP_V2_PRODUCER)(
    "genuine561 v2 producer offline replay/reuse has no new receipt fields " +
      mode,
    async () => {
      const old = process.env.ARCGIS_APP_V2_PRODUCER;
      expect(old).toBeTruthy();
      const f = await fixture(mode);
      try {
        const produced = await f.invoke(f.args, true, old);
        expect(produced.exit).toBe(0);
        const before = await snapshot(f.root);
        const verified = await f.invoke(
          ["verify", "--archive", f.root],
          false,
          undefined,
          false,
        );
        expect(verified.exit).toBe(0);
        const reused = await f.invoke(f.args, true, undefined, false);
        expect(reused.exit).toBe(0);
        expect(JSON.parse(reused.out).reused).toBe(true);
        expect(await snapshot(f.root)).toEqual(before);
        expect(f.wire.length).toBe(5);
        expect(f.wire.find((w) => w.data)?.identity).toBe(false);
      } finally {
        await f.close();
      }
    },
    15000,
  );
async function snapshot(root: string) {
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
  const bodies: Record<string, string> = {};
  for (const n of (await readdir(root)).sort())
    if (n.endsWith(".body"))
      bodies[n] = Buffer.from(await readFile(join(root, n))).toString("hex");
  return { logical, bodies };
}

test.skipIf(!process.env.ARCGIS_APP_V2_PRODUCER)(
  "unchanged561 standalone v2 default negotiates gzip20 decoded0 and holds",
  async () => {
    const f = await fixture("honor");
    try {
      const r = await f.invoke(
        f.args,
        true,
        process.env.ARCGIS_APP_V2_PRODUCER,
      );
      expect(r.exit).toBe(1);
      expect(f.wire.length).toBe(5);
      expect(f.wire.find((w) => w.data)).toMatchObject({
        identity: false,
        gzip: true,
        encoded: 20,
        ua: true,
      });
      const db = new Database(join(f.root, "state.sqlite"), { readonly: true });
      expect(
        db
          .query("SELECT status,bytes FROM attempts WHERE label=?")
          .get("app-data"),
      ).toEqual({ status: 200, bytes: 0 });
      expect(
        db
          .query("SELECT COUNT(*) n FROM observations WHERE label=?")
          .get("app-data"),
      ).toEqual({ n: 0 });
      expect(db.query("SELECT not_before FROM cooldown").get()).toEqual({
        not_before: Number.MAX_SAFE_INTEGER,
      });
      db.close();
    } finally {
      await f.close();
    }
  },
  15000,
);
test("composition invokes injected fetch and preserves promise", () => {
  const promise = Promise.resolve(new Response()),
    init = { signal: new AbortController().signal };
  const fetch: Dependencies["fetch"] = (url, options) => {
    expect(url).toBe(itemUrl(id, true));
    expect(options.signal).toBe(init.signal);
    expect(new Headers(options.headers).get("accept-encoding")).toBe(
      "identity",
    );
    return promise;
  };
  const result = appRequestDependencies(
    {
      command: "inspect-app",
      source: "austin",
      appDataFormat: "json-or-empty-v2",
      selection: { item: id },
    },
    { fetch },
  );
  expect(result.fetch!(itemUrl(id, true), init)).toBe(promise);
});

for (const install of [false, true])
  test(
    "already-open library encoding helper installed=" + install,
    async () => {
      const f = await fixture("honor");
      try {
        const entry = join(f.base, "library.ts");
        await writeFile(
          entry,
          `import {Archive} from ${JSON.stringify(resolve(import.meta.dir, "../src/archive.ts"))};import {parseArgs} from ${JSON.stringify(resolve(import.meta.dir, "../src/cli.ts"))};import {inspectApp} from ${JSON.stringify(resolve(import.meta.dir, "../src/app-metadata.ts"))};import {identityAppData} from ${JSON.stringify(resolve(import.meta.dir, "../src/app-encoding.ts"))};import {itemUrl} from ${JSON.stringify(resolve(import.meta.dir, "../src/sources.ts"))};const o=parseArgs(Bun.argv.slice(2));const a=await Archive.open(o.archive!,${install}?{fetch:identityAppData((url,init)=>globalThis.fetch(url,init),itemUrl(o.selection!.item,true))}:{});try{console.log(JSON.stringify(await inspectApp(a,"austin",{...o.selection!,termsSha256:o.termsSha256,catalogTermsSha256:o.catalogTermsSha256,appDataFormat:o.appDataFormat})));}catch(e){console.error("fixture capture refused");process.exitCode=1;}finally{await a.close();}`,
        );
        const r = await f.invoke(f.args, true, entry);
        expect(r.exit).toBe(install ? 0 : 1);
        expect(f.wire.length).toBe(5);
        expect(f.wire.find((w) => w.data)?.identity).toBe(install);
        const db = new Database(join(f.root, "state.sqlite"), {
          readonly: true,
        });
        expect(
          db
            .query("SELECT COUNT(*) n FROM observations WHERE label=?")
            .get("app-data"),
        ).toEqual({ n: install ? 1 : 0 });
        if (!install)
          expect(db.query("SELECT not_before FROM cooldown").get()).toEqual({
            not_before: Number.MAX_SAFE_INTEGER,
          });
        db.close();
      } finally {
        await f.close();
      }
    },
    15000,
  );
