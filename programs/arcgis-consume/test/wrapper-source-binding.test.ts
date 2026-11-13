import { test, expect } from "bun:test";
import { policyFixture } from "./support/policy-fixture";
import { Archive } from "../src/archive";
import { sourceBinding } from "../src/policy-inspection-receipt";
import { waiver } from "../src/wrapper-contract";
import { parseArgs } from "../src/cli";
test("raw wrapper binds retained catalog/app producer, not a self-consistent replacement", async () => {
  for (const fault of ["none", "argument-only", "binding-replacement"]) {
    const f = await policyFixture();
    let a: Archive | undefined;
    try {
      const p = await f.produce();
      expect(f.wire.length).toBe(6);
      const options = parseArgs([
        "inspect-wrapper",
        ...p.slice(1),
        "--acknowledge-maps-robots-omission",
      ]).wrapper!;
      let calls = 0,
        called = "";
      a = await Archive.open(f.root, {
        fetch: async (url) => {
          calls++;
          called = url;
          return new Response("<html></html>", {
            headers: { "content-type": "text/html", "content-length": "13" },
          });
        },
      });
      const actual = await sourceBinding(a.store.db, f.root, options, true);
      const replacement =
        "https://maps.austintexas.gov/NotTheCatalogApplication/";
      const binding = {
        ...actual,
        publishedURL:
          fault === "binding-replacement" ? replacement : actual.publishedURL,
      };
      const key = `austin:${options.item}:app-wrapper-v1`;
      a.store.source(
        key,
        "raw wrapper source-bound fixture",
        String(binding.publishedURL),
      );
      const run = a.store.start(key, "inspect-wrapper");
      a.store.saveOptions(run, {
        mode: "app-wrapper-v1",
        wrapperReceiptVersion: 1,
        wireKind: "wrapper-raw-v1",
        source: "austin",
        selection: options,
        binding,
        waiver: waiver(binding, run),
        budget: options.budget,
      });
      const before = a.store.db.serialize();
      const request = a.request(
        run,
        "wrapper-html",
        fault === "argument-only" ? replacement : String(binding.publishedURL),
        "wrapper-raw-v1",
      );
      if (fault === "none") {
        expect(await request).toEqual(Buffer.from("<html></html>"));
        expect(calls).toBe(1);
        expect(called).toBe(String(actual.publishedURL));
      } else {
        await expect(request).rejects.toThrow(/binding|source/);
        expect(calls).toBe(0);
        expect(a.store.db.serialize()).toEqual(before);
      }
    } finally {
      await a?.close();
      f.close();
    }
  }
}, 15000);
