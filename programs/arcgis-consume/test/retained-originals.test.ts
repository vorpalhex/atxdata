import { test, expect } from "bun:test";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { Archive } from "../src/archive";
import { Adapter } from "../src/adapter";
import { configs, type Source } from "../src/sources";
import { terms } from "../src/rules";

// Optional real-original byte regression. The manifest is local readonly input.
// Reconstructed ledgers and policy/transport fixtures are NEW, not recovered old state.
test.skipIf(!process.env.ARCGIS_ORIGINAL_INPUTS)(
  "actual original4/308 bytes reconstruct legacy ledgers and verify/reuse via native CLI without transport",
  async () => {
    const manifest = JSON.parse(
      await readFile(process.env.ARCGIS_ORIGINAL_INPUTS!, "utf8"),
    );
    const files = new Map<string, Buffer>();
    for (const [path, expected] of Object.entries(manifest.files) as [
      string,
      { bytes: number; sha256: string },
    ][]) {
      const raw = await readFile(path);
      expect(raw.length).toBe(expected.bytes);
      expect(createHash("sha256").update(raw).digest("hex")).toBe(
        expected.sha256,
      );
      files.set(basename(path), raw);
    }
    const body = (name: string) => {
      const raw = files.get(name);
      if (!raw) throw Error("missing retained input " + name);
      return new Uint8Array(raw);
    };
    for (const source of ["tnr", "voter"] as Source[]) {
      const root = await mkdtemp(
        join(process.env.TMPDIR!, "actual-reconstructed-"),
      );
      let clock = 0,
        calls = 0;
      const item = JSON.parse(
        new TextDecoder().decode(
          body(source === "tnr" ? "precinct-item.body" : "bulk-item.body"),
        ),
      );
      const a = await Archive.open(root, {
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
        fetch: async (u) => {
          calls++;
          const url = new URL(u),
            path = url.pathname;
          if (path.endsWith("robots.txt"))
            return new Response("User-agent: *\n"); // authored policy fixture
          if (path.endsWith(configs[source].item))
            return new Response(
              body(source === "tnr" ? "precinct-item.body" : "bulk-item.body"),
            );
          if (source === "tnr") {
            if (path.endsWith("/query")) {
              const name = url.searchParams.has("returnCountOnly")
                ? "precinct-count-before.body"
                : url.searchParams.has("returnIdsOnly")
                  ? "precinct-ids-before.body"
                  : Number(url.searchParams.get("resultOffset")) === 0
                    ? "precinct-recovered-page-0.body"
                    : "precinct-page-2.body";
              return new Response(body(name)); // repeated before/after metadata is explicitly a replay fixture
            }
            return new Response(
              body(
                path.endsWith("/0")
                  ? "precinct-layer.body"
                  : "precinct-service.body",
              ),
            );
          }
          if (path.endsWith(configs.voter.item + "/data"))
            return new Response(null, {
              status: 302,
              headers: {
                location:
                  "https://www.arcgis.com/itemdata/reconstruction/Election_Precincts.zip?signature=fixture",
              },
            });
          if (path.endsWith("Election_Precincts.zip"))
            return new Response(body("recovery-full.body"), {
              headers: { "content-type": "application/zip" },
            });
          throw Error("unexpected reconstruction fixture route");
        },
      });
      let run: string;
      try {
        const result: any = await new Adapter(a).execute(source, "collect", {
          termsSha256: terms(item).sha256,
        });
        run = result.run;
        expect(result.summary.records).toBe(source === "tnr" ? 4 : 308);
        expect(a.store.options(run)).toBeUndefined();
      } finally {
        await a.close();
      }
      const before = await Archive.open(root);
      const attempts = before.store.status().attempts;
      await before.close();
      const deny = join(root, "deny.ts");
      await writeFile(
        deny,
        'globalThis.fetch=async()=>{throw Error("unexpected transport during reconstructed replay")};',
      );
      const receipts = [];
      for (const args of [
        ["verify", "--archive", root],
        [
          "collect",
          "--source",
          source,
          "--archive",
          root,
          "--terms-sha256",
          terms(item).sha256,
        ],
      ]) {
        const p = Bun.spawn(
          [
            process.execPath,
            "--preload",
            deny,
            resolve(import.meta.dir, "../src/cli.ts"),
            ...args,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const [stdout, stderr, exit] = await Promise.all([
          new Response(p.stdout).text(),
          new Response(p.stderr).text(),
          p.exited,
        ]);
        expect(exit).toBe(0);
        const result = JSON.parse(stdout);
        if (args[0] === "collect") expect(result.reused).toBe(true);
        else expect(result.collections).toBe(1);
        receipts.push({ command: args[0], exit, stderr });
      }
      const after = await Archive.open(root);
      try {
        expect(after.store.status().attempts).toBe(attempts);
      } finally {
        await after.close();
      }
      await writeFile(
        join(root, "reconstruction-receipt.json"),
        JSON.stringify(
          {
            notice:
              "Actual original bytes, authored transport/policy/new ledger; NOT recovered old collector state or current availability",
            source,
            run: run!,
            records: source === "tnr" ? 4 : 308,
            fixtureCalls: calls,
            attempts,
            receipts,
          },
          null,
          2,
        ),
      );
    }
  },
);
