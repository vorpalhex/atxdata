import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { Archive } from "../src/archive";
import {
  verifySelection,
  executeSelection,
  selectionOptions,
} from "../src/selection";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { terms } from "../src/rules";
import { validateBudget } from "../src/policy";
import { id, item, fixture } from "./support/selection-fixture";
import { zipFixture } from "./zip.test";
import {
  ZipReader,
  Uint8ArrayReader,
  ZipWriter,
  Uint8ArrayWriter,
} from "@zip.js/zip.js";

const temp = () => mkdtemp(join(process.env.TMPDIR!, "repair-"));
async function rewrite(
  a: Archive,
  run: string,
  label: string,
  change: (v: any) => any,
) {
  const row = a.store.observation(run, label)!;
  const bytes = Buffer.from(
    JSON.stringify(
      change(JSON.parse(await readFile(join(a.root, row.path), "utf8"))),
    ),
  );
  await writeFile(join(a.root, row.path), bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  a.store.db
    .query("UPDATE observations SET sha256=?,bytes=? WHERE run=? AND label=?")
    .run(hash, bytes.length, run, label);
  a.store.db
    .query("UPDATE versions SET sha256=?,bytes=? WHERE label=? AND sha256=?")
    .run(hash, bytes.length, label, row.sha256);
}
function selectedFixture(url: string, catalogUrl = url) {
  const f = fixture(),
    fetch = f.deps.fetch;
  const selected = { ...item, url };
  const seen: string[] = [];
  f.deps.fetch = async (u) => {
    seen.push(u);
    const p = new URL(u).pathname;
    if (p.endsWith("/search"))
      return Response.json({
        total: 1,
        nextStart: -1,
        results: [{ ...selected, url: catalogUrl }],
      });
    if (p.endsWith(id)) return Response.json(selected);
    return fetch(u);
  };
  return { f, seen, selected };
}
const args = (root: string, command = "collect", urlItem = item) => [
  command,
  "--source",
  "tnr",
  "--archive",
  root,
  "--item",
  id,
  "--layer",
  "7",
  "--page-size",
  "4",
  "--terms-sha256",
  terms(urlItem).sha256,
];

test("A1 catalog-matched vendor tenant service is collected with its own robots gate", async () => {
  // Synthetic third tenant proves this is not a two-retained-item/tenant allowlist.
  const url =
    "https://services1.arcgis.com/ThirdTenant12345/arcgis/rest/services/Fixture/FeatureServer";
  const { f, seen, selected } = selectedFixture(url);
  const root = await temp();
  const result: any = await main(args(root, "collect", selected), f.deps);
  expect(result.summary).toMatchObject({ service: url, records: 13 });
  const robots = seen.indexOf("https://services1.arcgis.com/robots.txt");
  expect(robots).toBeGreaterThan(-1);
  expect(robots).toBeLessThan(seen.findIndex((u) => u.startsWith(url)));
  const before = seen.length;
  await main(["verify", "--archive", root], f.deps);
  expect(seen).toHaveLength(before);
});

test("A2 layer-suffixed advertisement keeps original identity and uses the service root", async () => {
  const url = item.url + "/7",
    { f, seen, selected } = selectedFixture(url),
    root = await temp();
  const result: any = await main(args(root, "collect", selected), f.deps);
  expect(result.summary).toMatchObject({
    records: 13,
    layer: 7,
    service: item.url,
  });
  expect(seen.some((u) => u.includes("/7/7"))).toBe(false);
  const a = await Archive.open(root);
  try {
    expect(
      (
        a.store.db
          .query("SELECT original_url FROM sources WHERE id LIKE 'tnr:%'")
          .get() as any
      ).original_url,
    ).toBe(url);
  } finally {
    await a.close();
  }
  const before = seen.length;
  await main(["verify", "--archive", root], f.deps);
  expect(seen).toHaveLength(before);
  const bad = selectedFixture(url);
  await expect(
    main(
      args(await temp(), "collect", bad.selected).map((v) =>
        v === "7" ? "8" : v,
      ),
      bad.f.deps,
    ),
  ).rejects.toThrow("layer");
  expect(bad.seen.some((u) => u.endsWith("/8?f=json"))).toBe(false);
});

test("L1 before and after layer metadata must each declare the selected ID, online and offline", async () => {
  for (const value of [8, undefined]) {
    for (const when of [0, 1, 2]) {
      const f = fixture(),
        fetch = f.deps.fetch;
      let reads = 0;
      f.deps.fetch = async (u) => {
        const response = await fetch(u);
        if (
          new URL(u).pathname.endsWith("/7") &&
          (++reads === when || when === 0)
        )
          return Response.json({ ...(await response.json()), id: value });
        return response;
      };
      await expect(main(args(await temp()), f.deps)).rejects.toThrow(
        "layer metadata identity",
      );
    }
    const root = await temp(),
      f = fixture(),
      result: any = await main(args(root), f.deps),
      a = await Archive.open(root, f.deps);
    try {
      for (const label of ["layer", "layer-after"])
        await rewrite(a, result.run, label, (v) => ({ ...v, id: value }));
      const calls = f.calls;
      await a.verify(); // hashes and version history deliberately still agree
      await expect(verifySelection(a, result.run)).rejects.toThrow(
        "layer metadata identity",
      );
      expect(f.calls).toBe(calls);
    } finally {
      await a.close();
    }
  }
});

test("L2 offline verification reconstructs every feature request and binds the creating attempt", async () => {
  for (const nonpaged of [false, true]) {
    const root = await temp(),
      f = fixture(nonpaged),
      result: any = await main(args(root), f.deps),
      a = await Archive.open(root, f.deps);
    try {
      for (const label of [
        "item-before",
        "item-after",
        "service",
        "service-after",
        "layer",
        "layer-after",
        "count-before",
        "count-after",
        "ids-before",
        "ids-after",
        "page-0",
        "page-4",
      ]) {
        const row = a.store.observation(result.run, label)!;
        for (const [column, value] of [
          ["url", row.url.replace("/7/", "/8/") + "&where=1%3D0"],
          ["kind", "text"],
        ]) {
          a.store.db
            .query(
              `UPDATE observations SET ${column}=? WHERE run=? AND label=?`,
            )
            .run(value, result.run, label);
          await expect(verifySelection(a, result.run)).rejects.toThrow(
            "checkpoint identity",
          );
          a.store.db
            .query(
              `UPDATE observations SET ${column}=? WHERE run=? AND label=?`,
            )
            .run((row as any)[column], result.run, label);
        }
      }
      const row = a.store.observation(result.run, "page-0")!;
      const attempt: any = a.store.db
        .query("SELECT * FROM attempts WHERE run=? AND label='page-0'")
        .get(result.run);
      for (const [column, value] of [
        ["url", row.url + "&where=1%3D0"],
        ["label", "page-other"],
        ["id", "unrelated"],
      ]) {
        a.store.db
          .query(`UPDATE attempts SET ${column}=? WHERE id=?`)
          .run(value, attempt.id);
        await expect(verifySelection(a, result.run)).rejects.toThrow(
          "attempt identity",
        );
        a.store.db
          .query(`UPDATE attempts SET ${column}=? WHERE id=?`)
          .run(attempt[column], column === "id" ? value : attempt.id);
      }
      await verifySelection(a, result.run);
    } finally {
      await a.close();
    }
  }
});

test("L3 library rejects invalid selection inputs before cache lookup or source writes", async () => {
  const root = await temp(),
    f = fixture();
  await main(args(root), f.deps);
  const a = await Archive.open(root, f.deps),
    calls = f.calls;
  try {
    const options = selectionOptions({
      "--item": id,
      "--layer": "7",
      "--page-size": "4",
    })!;
    const snapshot = () =>
      JSON.stringify({
        sources: a.store.db.query("SELECT * FROM sources").all(),
        runs: a.store.db.query("SELECT * FROM runs").all(),
        attempts: a.store.db.query("SELECT * FROM attempts").all(),
      });
    const before = snapshot();
    const invalid = [
      { budget: { ...options.budget, requests: -1 } },
      ...[
        "pageSize",
        "maxRecords",
        "maxPages",
        "expandedBytes",
        "maxMembers",
      ].flatMap((k) =>
        [0, -1, 1.5, NaN, Infinity, "2"].map((v) => ({ [k]: v })),
      ),
      { item: "bad" },
      { layer: -1 },
      { layer: 1.5 },
      { fields: [] },
      { fields: ["FID", "FID"] },
      { fields: ["bad-field"] },
      { fields: "FID" },
      { service: "https://localhost/FeatureServer" },
    ];
    for (const change of invalid)
      await expect(
        executeSelection(a, "tnr", "collect", { ...options, ...change } as any),
      ).rejects.toThrow();
    expect(snapshot()).toBe(before);
    expect(f.calls).toBe(calls);
  } finally {
    await a.close();
  }
});
test("L3 persisted generic budget rejects corruption before cached reads without erasing reservations", async () => {
  const root = await temp(),
    f = fixture(),
    fetch = f.deps.fetch;
  f.deps.fetch = async (u) =>
    u.endsWith("raw.csv")
      ? new Response("ID,Amount\n1,2\n", {
          headers: { "content-type": "text/csv" },
        })
      : fetch(u);
  const a = await Archive.open(root, f.deps);
  try {
    a.store.source("financial", "Raw CSV", "https://example.invalid/raw.csv");
    const run = a.store.start("financial", "collect");
    a.store.saveOptions(run, {
      budget: {
        requests: 3,
        totalBytes: 100000,
        responseBytes: 10000,
        zipBytes: 10000,
        retries: 0,
      },
    });
    const result = await a.request(
      run,
      "raw",
      "https://example.invalid/raw.csv",
      "file",
    );
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(result as Uint8Array).toString()).toBe(
      "ID,Amount\n1,2\n",
    );
    const attempt = a.store.attempt(
      run,
      "reserved",
      "https://example.invalid/reserved.csv",
      100,
    );
    const before = JSON.stringify(
        a.store.db.query("SELECT * FROM attempts").all(),
      ),
      calls = f.calls;
    for (const budget of [
      { requests: -1 },
      { requests: 1.5 },
      { retries: -1 },
      { responseBytes: 0 },
      { zipBytes: "100" },
      { requests: null },
      { timeoutMs: 0 },
    ]) {
      a.store.db
        .query("UPDATE acquisition_options SET options=? WHERE run=?")
        .run(JSON.stringify({ budget }), run);
      await expect(
        a.request(run, "raw", "https://example.invalid/raw.csv", "file"),
      ).rejects.toThrow("budget");
      await expect(a.read(run, "raw")).rejects.toThrow("budget");
      await expect(a.verify()).rejects.toThrow("budget");
      expect(
        JSON.stringify(a.store.db.query("SELECT * FROM attempts").all()),
      ).toBe(before);
      expect(f.calls).toBe(calls);
    }
    expect(attempt).toBeString();
  } finally {
    await a.close();
  }
});

test("raw-only unsupported Shapefiles retain checked ZIPs, not corrupt containers or invalid headers", async () => {
  const raw = await zipFixture();
  for (const mode of [
    "line",
    "multiple",
    "bad-header",
    "bad-zip",
    "bad-crc",
    "bad-missing-component",
  ]) {
    const reader = new ZipReader(new Uint8ArrayReader(raw)),
      writer = new ZipWriter(new Uint8ArrayWriter());
    for (const e of await reader.getEntries()) {
      if (mode === "bad-missing-component" && e.filename.endsWith(".dbf"))
        continue;
      if (e.directory) throw Error("fixture directory");
      const chunks: Uint8Array[] = [];
      await e.getData(
        new WritableStream({
          write(c) {
            chunks.push(c);
          },
        }),
      );
      const bytes = e.filename.endsWith(".prj")
        ? Buffer.from('GEOGCS["WGS 84",UNIT["degree",0.0174532925199433]]')
        : Buffer.concat(chunks);
      if (mode === "line" && /\.sh[px]$/.test(e.filename)) {
        bytes.writeInt32LE(3, 32);
        if (e.filename.endsWith(".shp")) bytes.writeInt32LE(3, 108);
      }
      if (mode === "bad-header" && e.filename.endsWith(".shp"))
        bytes.writeInt32BE(123, 0);
      await writer.add(e.filename, new Uint8ArrayReader(bytes), { level: 0 });
      if (mode === "multiple")
        await writer.add(
          e.filename.replace("Election_Precincts", "Second"),
          new Uint8ArrayReader(bytes),
          { level: 0 },
        );
    }
    await reader.close();
    let bytes = Buffer.from(await writer.close());
    if (mode === "bad-zip") bytes = bytes.subarray(0, bytes.length - 20);
    if (mode === "bad-crc") {
      const offset = bytes.indexOf(Buffer.from("GEOGCS"));
      expect(offset).toBeGreaterThan(-1);
      bytes[offset] = 88;
    }
    const selected = {
      ...item,
      type: "Shapefile",
      name: "Election_Precincts.zip",
      created: 1,
      size: bytes.length,
    };
    const f = fixture(),
      fetch = f.deps.fetch;
    f.deps.fetch = async (u) => {
      const p = new URL(u).pathname;
      if (p.endsWith("/search"))
        return Response.json({ total: 1, nextStart: -1, results: [selected] });
      if (p.endsWith(id + "/data"))
        return new Response(bytes, {
          headers: { "content-type": "application/zip" },
        });
      if (p.endsWith(id)) return Response.json(selected);
      return fetch(u);
    };
    const root = await temp();
    if (mode.startsWith("bad"))
      await expect(
        main(args(root, "collect", selected), f.deps),
      ).rejects.toThrow();
    else {
      const result: any = await main(args(root, "collect", selected), f.deps);
      expect(result.summary).toMatchObject({
        records: null,
        semanticStatus: "unsupported",
        format: "Shapefile",
      });
      const calls = f.calls;
      await main(["verify", "--archive", root], f.deps);
      expect(
        ((await main(args(root, "collect", selected), f.deps)) as any).reused,
      ).toBe(true);
      expect(f.calls).toBe(calls);
    }
  }
});

test("catalog/item tenant mismatch and a mismatched cached caller service never dispatch", async () => {
  const vendor =
    "https://services1.arcgis.com/TenantA/arcgis/rest/services/Fixture/FeatureServer";
  const mismatch = selectedFixture(
    vendor,
    vendor.replace("TenantA", "TenantB"),
  );
  await expect(
    main(args(await temp(), "collect", mismatch.selected), mismatch.f.deps),
  ).rejects.toThrow("identity mismatch");
  expect(
    mismatch.seen.some((u) => u.startsWith("https://services1.arcgis.com")),
  ).toBe(false);
  const root = await temp(),
    f = fixture();
  await main(args(root), f.deps);
  const calls = f.calls;
  await expect(
    main(
      [...args(root), "--service", item.url.replace("Fixture", "Different")],
      f.deps,
    ),
  ).rejects.toThrow("identity mismatch");
  expect(f.calls).toBe(calls);
});

test("generic partial budgets retain defaults but a complete GIS budget cannot omit any ceiling", async () => {
  expect(() => validateBudget({ requests: 1 })).not.toThrow();
  expect(() => validateBudget({ requests: 1 }, true)).toThrow("budget");
  const defaults = selectionOptions({ "--item": id })!.budget;
  for (const key of Object.keys(defaults)) {
    const b = { ...defaults };
    delete (b as any)[key];
    expect(() => validateBudget(b, true)).toThrow("budget");
  }
  let clock = 0;
  const a = await Archive.open(await temp(), {
    fetch: async () => new Response("id,value\n1,2\n"),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  try {
    a.store.source("csv", "Generic CSV", "https://example.invalid/raw.csv");
    const run = a.store.start("csv", "collect");
    a.store.saveOptions(run, { budget: { requests: 1 } });
    expect(
      Buffer.from(
        (await a.request(
          run,
          "first",
          "https://example.invalid/raw.csv",
          "file",
        )) as Uint8Array,
      ).toString(),
    ).toBe("id,value\n1,2\n");
    await expect(
      a.request(run, "second", "https://example.invalid/raw.csv", "file"),
    ).rejects.toThrow("ceiling");
    expect(a.store.budget(run).requests).toBe(1);
  } finally {
    await a.close();
  }
});
