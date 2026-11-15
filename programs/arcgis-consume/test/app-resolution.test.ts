import { test, expect } from "bun:test";
import { resolve } from "node:path";
test("native resolve-app capability is registered offline", () => {
  const p = Bun.spawnSync(
    [
      process.execPath,
      resolve(import.meta.dir, "../src/cli.ts"),
      "resolve-app",
      "--help",
    ],
    { env: process.env },
  );
  expect(p.exitCode, p.stderr.toString()).toBe(0);
  expect(p.stdout.toString()).toContain("wrapper-run");
});
import { readFileSync } from "node:fs";
import { policyFixture } from "./support/policy-fixture";
import { hash } from "../src/policy-inspection-receipt";
function inputs() {
  const x = JSON.parse(
    readFileSync(process.env.RESOLUTION_FIXTURE_MANIFEST!, "utf8"),
  );
  return x as {
    wrapper: string;
    captures: { url: string; path: string; sha256: string; mime: string }[];
    layer: string;
    layerMetadata: string;
    layerPage: string;
  };
}
test.skipIf(!process.env.RESOLUTION_FIXTURE_MANIFEST)(
  "actual released wrapper/config/WebMap/native polygon path and exact cache0 without catalog fiction",
  async () => {
    const x = inputs(),
      f = await policyFixture();
    try {
      const p = await f.produce();
      f.mode.status = 200;
      f.mode.body = readFileSync(x.wrapper);
      for (const row of x.captures) {
        const body = readFileSync(row.path);
        expect(hash(body)).toBe(row.sha256);
        f.mode.routes[row.url] = { body, mime: row.mime };
      }
      const wrapper = await f.invoke(["inspect-wrapper", ...p.slice(1)]);
      expect(wrapper.exit, wrapper.err).toBe(0);
      const root = JSON.parse(wrapper.out),
        common = [
          "--source",
          "austin",
          "--archive",
          f.root,
          "--wrapper-run",
          root.run,
          "--wrapper-sha256",
          root.summary.capture.sha256,
        ];
      async function context(parent?: string, helper?: string) {
        const r = await f.invoke([
          "resolve-app",
          ...common,
          ...(parent ? ["--parent-run", parent] : []),
          ...(helper ? ["--helper-run", helper] : []),
        ]);
        expect(r.exit, r.err).toBe(0);
        return JSON.parse(r.out);
      }
      async function child(
        parent: string | undefined,
        selector: (r: any) => boolean,
        helper?: string,
        depterms?: string,
      ) {
        const c = await context(parent, helper),
          ref = c.references.find(selector);
        expect(ref).toBeDefined();
        const args = [
            "resolve-app",
            ...common,
            ...(parent ? ["--parent-run", parent] : []),
            ...(helper ? ["--helper-run", helper] : []),
            "--reference-sha256",
            ref.sha256,
            ...(depterms ? ["--dependency-terms-sha256", depterms] : []),
          ],
          r = await f.invoke(args);
        expect(r.exit, r.err).toBe(0);
        const value = JSON.parse(r.out),
          before = f.wire.length,
          reuse = await f.invoke(args, true);
        expect(reuse.exit, reuse.err).toBe(0);
        expect(JSON.parse(reuse.out).reused).toBe(true);
        expect(f.wire.length).toBe(before);
        return value.run;
      }
      const frame = await child(undefined, (r) => r.role === "frame"),
        main = await child(frame, (r) => r.url?.endsWith("main.df002b54.js")),
        helper = await child(frame, (r) =>
          r.url?.endsWith("83645.1f73f100.js"),
        ),
        config = await child(main, (r) => r.role === "portal-config", helper),
        app = await child(config, (r) => r.role === "portal-app-item");
      const appContext = await context(app),
        appData = await child(
          app,
          (r) => r.role === "portal-app-data",
          undefined,
          appContext.references[0].requiredTermsSha256,
        ),
        map = await child(appData, (r) => r.role === "webmap-item"),
        mapContext = await context(map),
        mapData = await child(
          map,
          (r) => r.role === "webmap-data",
          undefined,
          mapContext.references[0].requiredTermsSha256,
        ),
        mapRefs = await context(mapData);
      expect(mapRefs.references.length).toBe(49);
      expect(mapRefs.distinctExactURLs).toBe(47);
      expect(mapRefs.catalogMembershipClaim).toBe(false);
      const meta = JSON.parse(readFileSync(x.layerMetadata, "utf8")),
        page = JSON.parse(readFileSync(x.layerPage, "utf8")),
        oid =
          meta.objectIdField ??
          meta.fields.find((f: any) => f.type === "esriFieldTypeOID").name,
        ids = {
          objectIdFieldName: oid,
          objectIds: page.features.map((r: any) => r.attributes[oid]),
        };
      const idsURL = new URL(x.layer + "/query");
      idsURL.search =
        "?f=json&where=1%3D1&returnIdsOnly=true&returnGeometry=false";
      f.mode.routes[idsURL.href] = {
        body: Buffer.from(JSON.stringify(ids)),
        mime: "application/json",
      };
      const count = Buffer.from(
        JSON.stringify({ count: page.features.length }),
      );
      // Deterministic query aliases are fixture routes, not invented public captures.
      const { queryUrl } = await import("../src/sources");
      f.mode.routes[queryUrl(x.layer, {})] = {
        body: readFileSync(x.layerMetadata),
        mime: "application/json",
      };
      f.mode.routes[
        queryUrl(x.layer + "/query", { where: "1=1", returnCountOnly: "true" })
      ] = { body: count, mime: "application/json" };
      f.mode.routes[
        queryUrl(x.layer + "/query", {
          where: "1=1",
          returnIdsOnly: "true",
          returnGeometry: "false",
        })
      ] = { body: Buffer.from(JSON.stringify(ids)), mime: "application/json" };
      f.mode.routes[
        queryUrl(x.layer + "/query", {
          where: "1=1",
          outFields: "OBJECTID,COUNCIL_DISTRICT,COUNCIL_DISTRICT_PATH",
          returnGeometry: "true",
          orderByFields: "OBJECTID ASC",
          resultOffset: "0",
          resultRecordCount: "10",
        })
      ] = { body: readFileSync(x.layerPage), mime: "application/json" };
      const inspected = await child(
        mapData,
        (r) => r.role === "layer" && r.literal === x.layer,
      );
      const inspection = await context(inspected);
      expect(inspection.metadataOnly).toBe(true);
      expect(inspection.nativeSchema).toEqual(meta);
      expect(inspection.publishedLayerURL).toBe(x.layer);
      expect(inspection.layerTermsSha256).toMatch(/^[a-f0-9]{64}$/);
      const args = [
        "collect-app-layer",
        ...common,
        "--parent-run",
        mapData,
        "--layer-url",
        x.layer,
        "--layer-terms-sha256",
        inspection.layerTermsSha256,
        "--max-records",
        "10",
        "--page-size",
        "10",
        "--response-bytes",
        "4194304",
        "--raw-bytes",
        "4194304",
        "--max-requests",
        "16",
      ];
      const missingRoot = f.root + "-missing-terms";
      const absent = args
        .filter(
          (_, i) =>
            i !== args.indexOf("--layer-terms-sha256") &&
            i !== args.indexOf("--layer-terms-sha256") + 1,
        )
        .map((v) => (v === f.root ? missingRoot : v));
      const noTerms = await f.invoke(absent);
      expect(noTerms.exit).toBe(1);
      expect(noTerms.err).toContain("reviewed layer terms required");
      expect(existsSync(missingRoot)).toBe(false);
      const collected = await f.invoke(args);
      expect(collected.exit, collected.err).toBe(0);
      const value = JSON.parse(collected.out);
      expect(value.summary.records).toBe(10);
      expect(value.summary.spatialReference).toMatchObject({
        wkid: 102739,
        latestWkid: 2277,
      });
      expect(value.summary.catalogMembershipClaim).toBe(false);
      expect(value.summary.service).toBe(x.layer);
      const before = f.wire.length;
      const reuse = await f.invoke(args, true);
      expect(reuse.exit, reuse.err).toBe(0);
      expect(JSON.parse(reuse.out).reused).toBe(true);
      expect((await f.invoke(["verify", "--archive", f.root], true)).exit).toBe(
        0,
      );
      expect(f.wire.length).toBe(before);
      expect(
        f.wire.filter(
          (r) => r.url === "https://maps.austintexas.gov/robots.txt",
        ),
      ).toEqual([]);
      const invalidBefore = f.wire.length,
        invalid = await f.invoke([
          "resolve-app",
          ...common.map((v) =>
            v === root.summary.capture.sha256 ? "0".repeat(64) : v,
          ),
        ]);
      expect(invalid.exit).toBe(1);
      expect(invalid.err).toContain("wrapper parent SHA");
      expect(f.wire.length).toBe(invalidBefore);
    } finally {
      f.close();
    }
  },
  120000,
);

import { Archive } from "../src/archive";
import {
  referenceOptions,
  referenceKind,
  referenceMode,
  validateReferenceOptions,
} from "../src/reference-contract";
import { referenceContext, resolveApp } from "../src/app-reference";
import { deriveReferences } from "../src/reference-derivation";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
async function parentFixture() {
  const x = inputs(),
    f = await policyFixture();
  const p = await f.produce();
  f.mode.status = 200;
  f.mode.body = readFileSync(x.wrapper);
  const wrapper = await f.invoke(["inspect-wrapper", ...p.slice(1)]);
  expect(wrapper.exit, wrapper.err).toBe(0);
  const r = JSON.parse(wrapper.out);
  const o = referenceOptions({
    "--source": "austin",
    "--archive": f.root,
    "--wrapper-run": r.run,
    "--wrapper-sha256": r.summary.capture.sha256,
  });
  return { f, o };
}
test.skipIf(!process.env.RESOLUTION_FIXTURE_MANIFEST)(
  "new derived contract: no required waiver, cross-origin role and finite selector budgets",
  async () => {
    const { f, o } = await parentFixture();
    try {
      expect(() => validateReferenceOptions(o)).not.toThrow();
      expect(() =>
        validateReferenceOptions({
          ...o,
          budget: { ...o.budget, requests: 17 },
        }),
      ).toThrow(/ceiling/);
      const doc = Buffer.from(
        '<iframe src="https://outside.example/public"></iframe><script src="/analytics.js"></script>',
      );
      const refs = await deriveReferences(
        doc,
        "https://maps.austintexas.gov/",
        256,
      );
      expect(refs.references.every((r) => r.role === "blocked")).toBe(true);
      await expect(
        deriveReferences(doc, "https://maps.austintexas.gov/", 1),
      ).rejects.toThrow(/ceiling/);
    } finally {
      f.close();
    }
  },
);
test.skipIf(!process.env.RESOLUTION_FIXTURE_MANIFEST)(
  "new raw bridge rejects coherent claimed URL/role replacement against real retained parent before HTTP or further ledger mutation",
  async () => {
    const { f, o } = await parentFixture();
    let calls = 0;
    const a = await Archive.open(f.root, {
      fetch: async () => {
        calls++;
        throw Error("HTTP FORBIDDEN");
      },
    });
    try {
      const c = await referenceContext(a.store.db, a.root, o),
        selected = c.derived.references.find((r) => r.role === "frame")!;
      const own = { ...o, referenceSha256: selected.sha256 },
        actual = await referenceContext(a.store.db, a.root, own),
        bad = "https://maps.austintexas.gov/Unpublished/";
      a.store.source("test:reference-bridge", "authored negative fixture", bad);
      const run = a.store.start("test:reference-bridge", "resolve-app");
      a.store.saveOptions(run, {
        mode: referenceMode,
        resolutionReceiptVersion: 1,
        wireKind: referenceKind,
        source: "austin",
        selection: own,
        binding: {
          ...actual.binding,
          selected: { ...actual.selected, url: bad, role: "script" },
        },
        waiver: {
          kind: "operator-scoped-robots-omission-v1",
          acknowledged: true,
          resource: "https://maps.austintexas.gov/robots.txt",
          operation: referenceMode,
          run,
          wrapperRun: o.wrapperRun,
          wrapperSha256: o.wrapperSha256,
        },
        budget: o.budget,
      });
      const before = a.store.db.serialize();
      await expect(
        a.request(run, "reference-body", bad, referenceKind),
      ).rejects.toThrow(/producer binding/);
      expect(a.store.db.serialize().equals(before)).toBe(true);
      expect(calls).toBe(0);
    } finally {
      await a.close();
      f.close();
    }
  },
);
for (const fault of ["missing", "corrupt"] as const)
  test.skipIf(!process.env.RESOLUTION_FIXTURE_MANIFEST)(
    "new operation refuses " +
      fault +
      " actual parent body before further ledger mutation or HTTP",
    async () => {
      const { f, o } = await parentFixture();
      let calls = 0;
      const a = await Archive.open(f.root, {
        fetch: async () => {
          calls++;
          throw Error("HTTP FORBIDDEN");
        },
      });
      try {
        const row = a.store.db
          .query<{ path: string }, [string]>(
            "SELECT path FROM observations WHERE run=?",
          )
          .get(o.wrapperRun);
        expect(row).not.toBeNull();
        if (fault === "missing") await unlink(join(f.root, row!.path));
        else await writeFile(join(f.root, row!.path), Buffer.from("corrupt"));
        const before = a.store.db.serialize();
        await expect(resolveApp(a, o)).rejects.toThrow();
        expect(a.store.db.serialize().equals(before)).toBe(true);
        expect(calls).toBe(0);
      } finally {
        await a.close();
        f.close();
      }
    },
  );

import { existsSync } from "node:fs";
import { typedAppReferences } from "../src/reference-config";
test.skipIf(!process.env.RESOLUTION_FIXTURE_MANIFEST)(
  "retained actual Portal literal with one TAB is refused before URL normalization",
  () => {
    const x = inputs(),
      row = x.captures.find(
        (r) =>
          r.url.includes(
            "austin.maps.arcgis.com/sharing/rest/content/items/",
          ) && r.url.endsWith("/data?f=json"),
      )!;
    const v = JSON.parse(readFileSync(row.path, "utf8")),
      item = v.items.find(
        (i: any) => i.$type === "map-extension" && typeof i.webMap === "string",
      );
    const original = item.webMap;
    expect(
      typedAppReferences(
        Buffer.from(JSON.stringify(v)),
        row.url,
        256,
      ).references.some((r) => r.literal === original),
    ).toBe(true);
    item.webMap = original.replace("https://", "https://\t");
    expect(() =>
      typedAppReferences(Buffer.from(JSON.stringify(v)), row.url, 256),
    ).toThrow();
  },
);
