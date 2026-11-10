import { test, expect } from "bun:test";
import {
  ZipReader,
  Uint8ArrayReader,
  ZipWriter,
  Uint8ArrayWriter,
} from "@zip.js/zip.js";
import { zipFixture } from "./zip.test";
import { validateZip } from "../src/zip";
export async function largeZip() {
  const original = await zipFixture(),
    reader = new ZipReader(new Uint8ArrayReader(original)),
    parts = new Map<string, Buffer>();
  for (const e of await reader.getEntries()) {
    if (!e.directory) {
      const chunks: Buffer[] = [];
      await e.getData(
        new WritableStream({
          write(c) {
            chunks.push(Buffer.from(c));
          },
        }),
      );
      parts.set(
        e.filename.replace("Election_Precincts", "Other_Boundaries"),
        Buffer.concat(chunks),
      );
    }
  }
  await reader.close();
  const count = 1001,
    old = parts.get("Other_Boundaries.shp")!,
    record = old.subarray(100),
    shp = Buffer.alloc(100 + count * record.length),
    shx = Buffer.alloc(100 + count * 8);
  old.copy(shp, 0, 0, 100);
  parts.get("Other_Boundaries.shx")!.copy(shx, 0, 0, 100);
  for (let i = 0; i < count; i++) {
    record.copy(shp, 100 + i * record.length);
    shp.writeInt32BE(i + 1, 100 + i * record.length);
    shx.writeInt32BE((100 + i * record.length) / 2, 100 + i * 8);
    shx.writeInt32BE((record.length - 8) / 2, 104 + i * 8);
  }
  for (const b of [shp, shx]) b.writeInt32BE(b.length / 2, 24);
  const d = parts.get("Other_Boundaries.dbf")!,
    head = d.readUInt16LE(8),
    size = d.readUInt16LE(10),
    dbf = Buffer.alloc(head + size * count + 1, 32);
  d.copy(dbf, 0, 0, head);
  dbf.writeUInt32LE(count, 4);
  for (let i = 0; i < count; i++) {
    d.copy(dbf, head + i * size, head, head + size);
    dbf.fill(32, head + i * size + 1, head + i * size + 11);
    dbf.write(String(i + 1), head + i * size + 1);
  }
  dbf[dbf.length - 1] = 26;
  parts.set("Other_Boundaries.shp", shp);
  parts.set("Other_Boundaries.shx", shx);
  parts.set("Other_Boundaries.dbf", dbf);
  parts.set(
    "Other_Boundaries.prj",
    Buffer.from('GEOGCS["WGS 84",UNIT["degree",0.0174532925199433]]'),
  );
  parts.set("Other_Boundaries.txt", Buffer.alloc(1_100_000, 65));
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, b] of parts)
    await writer.add(name, new Uint8ArrayReader(b), { level: 0 });
  return Buffer.from(await writer.close());
}
test("generic shapefile accepts advertised basename, additional safe members, >1000 records and >1MB without changing native PRJ", async () => {
  const zip = await largeZip(),
    options = {
      basename: "Other_Boundaries",
      rawBytes: 4_000_000,
      expandedBytes: 5_000_000,
      maxRecords: 2000,
      maxMembers: 20,
    };
  const result = await validateZip(zip, zip.length, options);
  expect(result.records).toBe(1001);
  expect(result.members).toHaveLength(7);
  await expect(
    validateZip(zip, zip.length, { ...options, maxRecords: 1000 }),
  ).rejects.toThrow();
  await expect(
    validateZip(zip, zip.length, { ...options, basename: "Wrong" }),
  ).rejects.toThrow();
  await expect(
    validateZip(zip, zip.length, { ...options, expandedBytes: 100 }),
  ).rejects.toThrow();
});
