import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
import { largeZip } from "./generic-zip.test";
test("shipped CLI acquires nondefault published shapefile and direct opaque files with separate source and signed URL identities", async () => {
  for (const shape of [true, false]) {
    const bytes = shape
        ? await largeZip()
        : Buffer.from("synthetic unsupported file"),
      id = "f".repeat(32),
      group = "b".repeat(32),
      name = shape ? "Other_Boundaries.zip" : "Other.bin";
    const item = {
      id,
      title: "Other published item",
      name,
      type: shape ? "Shapefile" : "Unknown published format",
      access: "public",
      created: 1,
      modified: 2,
      size: bytes.length,
      licenseInfo: "synthetic only",
    };
    const root = await mkdtemp(
      join(process.env.TMPDIR!, "published-selection-"),
    );
    let now = 0,
      calls = 0;
    const deps = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      fetch: async (url: string) => {
        calls++;
        const u = new URL(url);
        if (u.pathname.endsWith("robots.txt"))
          return new Response("User-agent: *\n");
        if (u.pathname.endsWith("/search"))
          return Response.json({ total: 1, nextStart: -1, results: [item] });
        if (u.pathname.endsWith(configs.voter.site + "/data"))
          return Response.json({
            catalog: { groups: [group] },
            catalogV2: {
              scopes: {
                item: { filters: [{ predicates: [{ group: [group] }] }] },
              },
            },
          });
        if (u.pathname.endsWith(configs.voter.site))
          return Response.json({
            id: configs.voter.site,
            title: "Hub",
            access: "public",
          });
        if (
          u.pathname.includes("/itemdata/") ||
          (!shape && u.pathname.endsWith(id + "/data"))
        )
          return new Response(bytes, {
            headers: {
              "Content-Type": shape
                ? "application/zip"
                : "application/octet-stream",
            },
          });
        if (u.pathname.endsWith(id + "/data"))
          return new Response(null, {
            status: 302,
            headers: {
              location:
                "https://www.arcgis.com/itemdata/fixture/" +
                name +
                "?signature=fixture",
            },
          });
        return Response.json(item);
      },
    };
    const args = [
      "collect",
      "--archive",
      root,
      "--source",
      "voter",
      "--item",
      id,
      "--terms-sha256",
      terms(item).sha256,
    ];
    const result: any = await main(args, deps);
    expect(result.summary).toMatchObject(
      shape
        ? { records: 1001, semanticStatus: "validated-shapefile" }
        : { semanticStatus: "opaque-unsupported" },
    );
    const before = calls;
    expect(((await main(args, deps)) as any).reused).toBe(true);
    await main(["verify", "--archive", root], deps);
    expect(calls).toBe(before);
  }
});
