import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { Engine, sha } from "../src/engine";
import * as api from "../src/engine";
import { discover } from "../src/adapters";
import { cityPdf } from "./austin-fixtures";
import { state } from "./integrity-state";
const council = "austin-council-archives",
  election = "austin-election-publications",
  policy = "publisher-linked-original-v1";
function original() {
  return JSON.parse(readFileSync(process.env.CITY_NOTICE_INPUT!, "utf8"));
}
function city() {
  return JSON.parse(readFileSync(process.env.CITY_SOURCE_INPUTS!, "utf8")) as {
    url: string;
    path: string;
    sha256: string;
  }[];
}
function councilInput() {
  const x = city().find((x) => /held-1869$/.test(x.url))!;
  expect(x).toBeDefined();
  expect(sha(readFileSync(x.path))).toBe(x.sha256);
  return x;
}
test("registered original-retention command is real offline native capability", () => {
  const p = Bun.spawnSync(
    [
      process.execPath,
      join(import.meta.dir, "../src/cli.ts"),
      "retain-capture",
      "--help",
    ],
    { env: process.env },
  );
  expect(p.exitCode, p.stderr.toString()).toBe(0);
  expect(p.stdout.toString()).toContain("capture-attempt");
});
test("metadata7 preserves actual published HTTP hrefs while old6 stays zero, generic IDs and source guards", () => {
  const x = councilInput(),
    html = readFileSync(x.path, "utf8");
  expect(discover(council, x.url, html, 6)).toEqual([]);
  const rows = discover(council, x.url, html, 7);
  expect(rows.length).toBe(2);
  expect(rows.map((r) => (r as any).publishedHref).sort()).toEqual([
    "http://www.austintexas.gov/edims/document.cfm?id=125105",
    "http://www.austintexas.gov/edims/document.cfm?id=125106",
  ]);
  for (const r of rows) {
    expect(r.href).toBe((r as any).publishedHref);
    expect(r.url).toBe(r.href.replace("http://www.", "https://services."));
    expect((r as any).endpointPolicy.policy).toBe(
      "published-legacy-edims-https-services-v1",
    );
    expect(r.year).toBe("1869");
  }
  const page =
      "https://www.austintexas.gov/content/archive-council-meetings-held-2037",
    label = "City Council Meeting Minutes January 9, 2037",
    href = "http://www.austintexas.gov/edims/document.cfm?id=900017";
  expect(
    discover(
      council,
      page,
      `<article><a href="${href}">${label}</a></article>`,
      7,
    )[0]!.url,
  ).toEndWith("id=900017");
  for (const bad of [
    href + "&x=1",
    href + "#x",
    href.replace("www.", "evil."),
    href.replace("www.", "user@www."),
    href.replace("id=900017", "id=x"),
    href.replace("http:", "https:"),
    href.replace("document.cfm", "../edims/document.cfm"),
  ])
    expect(
      discover(
        council,
        page,
        `<article><a href="${bad}">${label}</a></article>`,
        7,
      ),
    ).toEqual([]);
  expect(() =>
    discover(
      election,
      "https://www.austintexas.gov/clerk/programs/elections",
      html,
      7,
    ),
  ).toThrow();
});
async function fixture(
  source: typeof council | typeof election,
  pdf: Uint8Array,
  legacy = false,
) {
  const base = await mkdtemp(join(process.env.TMPDIR!, "original-native-")),
    root = join(base, "archive"),
    x = original(),
    a = x.admission,
    y = councilInput();
  const page = source === council ? y.url : a.page,
    start =
      source === council
        ? "https://www.austintexas.gov/council/archive/city_council_meeting_archives"
        : "https://www.austintexas.gov/clerk/programs/elections",
    html =
      source === council
        ? readFileSync(y.path, "utf8")
        : `<article><a href="${a.url}">${a.label}</a></article>`;
  const calls: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const u = req.headers.get("x-fixture-url")!;
      calls.push(u);
      if (u === "https://services.austintexas.gov/robots.txt")
        return new Response("", {
          status: 302,
          headers: {
            location: "https://www.austintexas.gov/robots.txt",
            "content-type": "text/plain",
          },
        });
      if (u.endsWith("/robots.txt"))
        return new Response("User-agent: *\nAllow: /\n", {
          headers: { "content-type": "text/plain" },
        });
      if (u === start)
        return new Response(
          `<article><a href="${page}">${source === council ? "1869" : "2026"} archive</a></article>`,
          { headers: { "content-type": "text/html" } },
        );
      if (u === page)
        return new Response(html, { headers: { "content-type": "text/html" } });
      return new Response(new Uint8Array(pdf), {
        headers: { "content-type": "application/pdf" },
      });
    },
  });
  const preload = join(base, "preload.ts"),
    encoding = join(import.meta.dir, "../src/encoding.ts");
  await writeFile(
    preload,
    `import {mock} from 'bun:test';const p=${JSON.stringify(encoding)},m={...await import(p)};mock.module(p,()=>({...m,rawFetch:(url,init={})=>{const h=new Headers(init.headers);h.set('x-fixture-url',url);return m.rawFetch(${JSON.stringify(server.url.href)},{...init,headers:h});}}));`,
  );
  async function invoke(command: string, args: string[], target = root) {
    const p = Bun.spawn(
      [
        process.execPath,
        "--preload",
        preload,
        join(import.meta.dir, "../src/cli.ts"),
        command,
        "--root",
        target,
        ...args,
      ],
      { env: process.env, stdout: "pipe", stderr: "pipe" },
    );
    const [out, err, exit] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { out, err, exit };
  }
  const r = await invoke("discover", [
    "--source",
    source,
    "--page",
    start,
    "--max-pages",
    "2",
    "--allow-network",
    ...(legacy ? ["--resolve-legacy-edims"] : []),
  ]);
  expect(r.exit, r.err).toBe(0);
  return { root, base, calls, server, invoke };
}
test("Council metadata7 native HTTPS capture-only and explicit raw cache/list/verify, semantic defaults refuse", async () => {
  const f = await fixture(
    council,
    cityPdf("Historical scan original, not a semantic title"),
    true,
  );
  try {
    let r = await f.invoke("collect", [
      "--source",
      council,
      "--limit",
      "1",
      "--allow-network",
      "--capture-only",
    ]);
    expect(r.exit, r.err).toBe(0);
    const count = f.calls.length;
    expect(f.calls.every((u) => u.startsWith("https://"))).toBe(true);
    expect(
      f.calls.some((u) =>
        /^https:\/\/services\.austintexas\.gov\/edims\/document\.cfm\?id=12510[56]$/.test(
          u,
        ),
      ),
    ).toBe(true);
    const e = await Engine.open(f.root);
    const rows = e.list(council, { limit: 1, captureOnly: true } as any);
    expect(rows[0]!.status).toBe("captured");
    const receipt = JSON.parse(
      e.db.query<any, []>("SELECT validation FROM versions").get().validation,
    );
    expect(receipt.structure.pdfVersion).not.toBeNull();
    expect(receipt.structure.encrypted).toBe("no");
    expect(receipt).toMatchObject({
      schema: 9,
      identityPolicy: policy,
      quality: "original-integrity-only",
      semanticIdentityValidated: false,
      structuredInterpretation: false,
    });
    expect(
      e.list(council, { limit: 2 }).every((r) => r.status !== "captured"),
    ).toBe(true);
    await e.close();
    for (const cmd of ["verify", "collect", "list"]) {
      r = await f.invoke(cmd, [
        "--source",
        council,
        "--limit",
        "1",
        "--capture-only",
        ...(cmd === "collect" ? ["--allow-network"] : []),
      ]);
      expect(r.exit, r.err).toBe(0);
      expect(r.out).toContain("original-integrity-only");
    }
    expect(f.calls.length).toBe(count);
    // Bound source policy aliases and version marker must not disappear in replay.
    for (const [name, sql] of [
      [
        "alias",
        "UPDATE observations SET evidence=json_remove(evidence,'$.publishedHref')",
      ],
      [
        "downgrade",
        "UPDATE snapshot_metadata SET adapter_schema=6 WHERE adapter_schema=7",
      ],
    ]) {
      const target = join(f.base, name);
      await cp(f.root, target, { recursive: true });
      const lib = await Engine.open(target);
      lib.db.exec(sql!);
      await expect(lib.preflight()).rejects.toThrow();
      await lib.close();
    }
  } finally {
    f.server.stop(true);
  }
}, 120000);
test("actual complete failed election capture -> always-offline raw9, immutable HTTP facts, strict refusal and raw cache", async () => {
  const x = original(),
    pdf = readFileSync(x.path);
  expect(pdf.length).toBe(480963);
  expect(sha(pdf)).toBe(x.sha256);
  const f = await fixture(election, pdf);
  try {
    let r = await f.invoke("collect", [
      "--source",
      election,
      "--limit",
      "1",
      "--allow-network",
    ]);
    expect(r.exit).toBe(1);
    expect(r.err).toContain("identity unresolved");
    await Bun.sleep(3100);
    const e = await Engine.open(f.root),
      row = e.list(election, { limit: 1 })[0]!,
      attempt = e.db
        .query<any, []>("SELECT * FROM attempts WHERE kind='pdf'")
        .get();
    expect(attempt.status).toBe(200);
    expect(attempt.ended).not.toBeNull();
    expect(attempt.error).toBeNull();
    const selection = (api as any).captureSelectionHash(row),
      args = [
        "--source",
        election,
        "--observation",
        row.id,
        "--capture-attempt",
        attempt.id,
        "--document-sha",
        x.sha256,
        "--selection-sha",
        selection,
      ];
    const tables = [
        "attempts",
        "representations",
        "snapshots",
        "snapshot_metadata",
        "snapshot_producers",
        "runs",
      ],
      facts = Object.fromEntries(
        tables.map((t) => [
          t,
          e.db.query(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ]),
      );
    await e.close();
    const seed = join(f.base, "failed");
    await cp(f.root, seed, { recursive: true });
    for (const [name, sql, selected] of [
      ["hash", null, args.map((v) => (v === x.sha256 ? "0".repeat(64) : v))],
      ["unknown", "UPDATE attempts SET ended=NULL WHERE kind='pdf'", args],
      ["held", "UPDATE cooldowns SET blocked='manual hold'", args],
      ["corrupt", null, args],
      ["budget", null, [...args, "--max-pdf-bytes", "1"]],
      ["missing-producer", "DELETE FROM snapshot_producers", args],
    ] as [string, string | null, string[]][]) {
      const target = join(f.base, name);
      await cp(seed, target, { recursive: true });
      const lib = await Engine.open(target);
      if (sql) lib.db.exec(sql);
      if (name === "corrupt")
        await writeFile(join(target, x.sha256 + ".candidate"), "corrupt");
      const request = {
        source: election,
        observation: row.id,
        captureAttempt: attempt.id,
        documentSha256: name === "hash" ? "0".repeat(64) : x.sha256,
        selectionSha256: selection,
        bodyPolicy: policy,
      };
      const prior = await state(target);
      await expect(
        (lib as any).retainCapture(
          request,
          name === "budget" ? { maxPdfBytes: 1 } : {},
        ),
      ).rejects.toThrow();
      expect(await state(target)).toEqual(prior);
      await lib.close();
      await writeFile(join(target, ".civicclerk.lock"), "sentinel");
      const before = await state(target);
      const refused = await f.invoke("retain-capture", selected, target);
      expect(refused.exit, name).toBe(1);
      expect(refused.err, name).not.toContain("EEXIST");
      expect(await state(target)).toEqual(before);
    }
    const late = join(f.base, "late-hold");
    await cp(seed, late, { recursive: true });
    const delayed = await Engine.open(late),
      oldRead = delayed.readArtifact.bind(delayed);
    let armed = true;
    const unchangedTables = [
        "versions",
        "history",
        "validation_history",
        "runs",
        "artifact_checkpoints",
      ],
      priorTables = unchangedTables.map((t) =>
        delayed.db.query(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      );
    delayed.readArtifact = async (path: string) => {
      const body = await oldRead(path);
      if (armed && path.endsWith(".candidate")) {
        armed = false;
        delayed.db.exec("UPDATE cooldowns SET blocked='late manual hold'");
      }
      return body;
    };
    await expect(
      (delayed as any).retainCapture({
        source: election,
        observation: row.id,
        captureAttempt: attempt.id,
        documentSha256: x.sha256,
        selectionSha256: selection,
        bodyPolicy: policy,
      }),
    ).rejects.toThrow(/held/);
    expect(
      unchangedTables.map((t) =>
        delayed.db.query(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      ),
    ).toEqual(priorTables);
    await delayed.close();
    const wire = f.calls.length;
    r = await f.invoke("retain-capture", args);
    expect(r.exit, r.err).toBe(0);
    expect(r.out).toContain("original-integrity-only");
    expect(f.calls.length).toBe(wire);
    const check = await Engine.open(f.root);
    for (const t of tables) {
      const rows = check.db
        .query<any, []>(`SELECT * FROM ${t} ORDER BY rowid`)
        .all();
      expect(t === "runs" ? rows.slice(0, facts[t].length) : rows).toEqual(
        facts[t],
      );
    }
    expect(check.observation(row.id).status).toBe("captured");
    await expect(check.verify(election, { limit: 1 })).rejects.toThrow();
    expect(
      await check.verify(election, { limit: 1, captureOnly: true } as any),
    ).toMatchObject({
      quality: "original-integrity-only",
      semanticIdentityValidated: false,
      httpRequests: 0,
    });
    await check.close();
    for (const command of ["verify", "collect"]) {
      r = await f.invoke(command, [
        "--source",
        election,
        "--limit",
        "1",
        "--capture-only",
        ...(command === "collect" ? ["--allow-network"] : []),
      ]);
      expect(r.exit, r.err).toBe(0);
    }
    expect(f.calls.length).toBe(wire);
    const before = await state(f.root);
    r = await f.invoke("retain-capture", args);
    expect(r.exit).toBe(1);
    expect(await state(f.root)).toEqual(before);
  } finally {
    f.server.stop(true);
  }
}, 120000);

test("original integrity checks magic, MIME, structural parser and no fresh archive/override", async () => {
  const { requirePdf, inspectOriginal } = await import("../src/pdf");
  expect(() =>
    requirePdf(Buffer.from("not a PDF"), "application/pdf", 1024),
  ).toThrow(/magic/);
  expect(() => requirePdf(Buffer.from("%PDF-1.7"), "text/html", 1024)).toThrow(
    /MIME/,
  );
  const dir = await mkdtemp(join(process.env.TMPDIR!, "original-invalid-")),
    bad = join(dir, "bad.pdf"),
    root = join(dir, "absent");
  await writeFile(bad, "%PDF-1.7 invalid");
  await expect(inspectOriginal(bad)).rejects.toThrow(/parser/);
  const id = "00000000-0000-4000-8000-000000000000",
    valid = [
      "retain-capture",
      "--root",
      root,
      "--source",
      election,
      "--observation",
      id,
      "--capture-attempt",
      id,
      "--document-sha",
      "0".repeat(64),
      "--selection-sha",
      "0".repeat(64),
    ],
    { run } = await import("../src/cli");
  await expect(run(valid)).rejects.toThrow(/existing archive/);
  for (const flags of [
    ["--input", bad],
    ["--origin", "retained"],
    ["--allow-network"],
  ])
    await expect(run([...valid, ...flags])).rejects.toThrow(/forbids/);
  expect(await (await import("node:fs/promises")).readdir(dir)).not.toContain(
    "absent",
  );
});
