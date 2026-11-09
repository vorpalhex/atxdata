import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import {
  ZipReader,
  ZipWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js";
import { zipFixture } from "./zip.test";
import { fixture, item, id } from "./support/selection-fixture";
import { main } from "../src/cli";
import { terms } from "../src/rules";

async function rawShape(groups: number, fault: string) {
  const reader = new ZipReader(new Uint8ArrayReader(await zipFixture()));
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const entry of await reader.getEntries()) {
    if (entry.directory) throw Error("fixture directory");
    const chunks: Uint8Array[] = [];
    await entry.getData(
      new WritableStream({
        write(c) {
          chunks.push(c);
        },
      }),
    );
    for (let group = 0; group < groups; group++) {
      let bytes = entry.filename.endsWith(".prj")
        ? Buffer.from('GEOGCS["fixture"]')
        : Buffer.concat(chunks);
      if (/\.sh[px]$/.test(entry.filename)) {
        bytes.writeInt32LE(3, 32);
        if (entry.filename.endsWith(".shp")) bytes.writeInt32LE(3, 108);
      }
      if (group === groups - 1) {
        if (["empty-table", "zero-size-empty-table"].includes(fault)) {
          if (/\.sh[px]$/.test(entry.filename)) {
            bytes = bytes.subarray(0, 100);
            bytes.writeInt32BE(50, 24);
          }
          if (entry.filename.endsWith(".dbf")) {
            bytes = Buffer.alloc(33);
            bytes[0] = 3;
            bytes.writeUInt16LE(33, 8);
            bytes.writeUInt16LE(fault === "empty-table" ? 1 : 0, 10);
            bytes[32] = 13;
          }
        }
        if (fault === "no-eof" && entry.filename.endsWith(".dbf"))
          bytes = bytes.subarray(0, bytes.length - 1);
        if (fault === "one-byte-prj" && entry.filename.endsWith(".prj"))
          bytes = Buffer.from("X");
        if (fault === "empty-dbf" && entry.filename.endsWith(".dbf"))
          bytes = Buffer.alloc(0);
        if (fault === "bad-dbf-length" && entry.filename.endsWith(".dbf"))
          bytes.writeUInt32LE(1234, 4);
        if (fault === "zero-record-size" && entry.filename.endsWith(".dbf"))
          bytes.writeUInt16LE(0, 10);
        if (fault === "empty-prj" && entry.filename.endsWith(".prj"))
          bytes = Buffer.from(" \n\t");
      }
      await writer.add(
        group === 0
          ? entry.filename
          : entry.filename.replace("Election_Precincts", "Second"),
        new Uint8ArrayReader(bytes),
        { level: 0 },
      );
    }
  }
  await reader.close();
  return Buffer.from(await writer.close());
}
test("R1 every unsupported shape group validates basic DBF lengths and nonempty projection before raw acceptance", async () => {
  for (const groups of [1, 2])
    for (const fault of [
      "none",
      "empty-table",
      "zero-size-empty-table",
      "no-eof",
      "one-byte-prj",
      "empty-dbf",
      "bad-dbf-length",
      "zero-record-size",
      "empty-prj",
    ]) {
      const bytes = await rawShape(groups, fault),
        root = await mkdtemp(join(process.env.TMPDIR!, "unsupported-basic-"));
      const selected = {
        ...item,
        type: "Shapefile",
        name: "Election_Precincts.zip",
        size: bytes.length,
        created: 1,
      };
      const f = fixture(),
        fetch = f.deps.fetch;
      f.deps.fetch = async (u) => {
        const p = new URL(u).pathname;
        if (p.endsWith("/search"))
          return Response.json({
            total: 1,
            nextStart: -1,
            results: [selected],
          });
        if (p.endsWith(id + "/data"))
          return new Response(bytes, {
            headers: { "content-type": "application/zip" },
          });
        if (p.endsWith(id)) return Response.json(selected);
        return fetch(u);
      };
      const args = [
        "collect",
        "--source",
        "tnr",
        "--item",
        id,
        "--archive",
        root,
        "--terms-sha256",
        terms(selected).sha256,
      ];
      if (!["none", "empty-table", "no-eof", "one-byte-prj"].includes(fault))
        await expect(main(args, f.deps)).rejects.toThrow(
          fault === "empty-prj" ? "projection" : "DBF",
        );
      else {
        expect(((await main(args, f.deps)) as any).summary).toMatchObject({
          semanticStatus: "unsupported",
          records: null,
        });
        const calls = f.calls;
        await main(["verify", "--archive", root], f.deps);
        expect(f.calls).toBe(calls);
      }
    }
});
