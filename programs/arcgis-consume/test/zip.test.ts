import { test, expect } from "bun:test";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js";
import { validateZip, dbfFields } from "../src/zip";
export async function zipFixture(badName?: string) {
  const points = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
    content = 44 + 4 + points.length * 16;
  const shp = Buffer.alloc(100 + 8 + content),
    shx = Buffer.alloc(100 + 8);
  for (const b of [shp, shx]) {
    b.writeInt32BE(9994, 0);
    b.writeInt32BE(b.length / 2, 24);
    b.writeInt32LE(1000, 28);
    b.writeInt32LE(5, 32);
    b.writeDoubleLE(1, 52);
    b.writeDoubleLE(1, 60);
  }
  shp.writeInt32BE(1, 100);
  shp.writeInt32BE(content / 2, 104);
  shp.writeInt32LE(5, 108);
  shp.writeDoubleLE(1, 128);
  shp.writeDoubleLE(1, 136);
  shp.writeInt32LE(1, 144);
  shp.writeInt32LE(points.length, 148);
  points.forEach((p, i) => {
    shp.writeDoubleLE(p[0], 156 + i * 16);
    shp.writeDoubleLE(p[1], 164 + i * 16);
  });
  shx.writeInt32BE(50, 100);
  shx.writeInt32BE(content / 2, 104);
  const head = 32 + 32 * dbfFields.length + 1,
    record = 1 + dbfFields.length * 10,
    dbf = Buffer.alloc(head + record + 1, 32);
  dbf[0] = 3;
  dbf.writeUInt32LE(1, 4);
  dbf.writeUInt16LE(head, 8);
  dbf.writeUInt16LE(record, 10);
  dbfFields.forEach((name, i) => {
    const off = 32 + i * 32;
    dbf.fill(0, off, off + 32);
    dbf.write(name, off, "ascii");
    dbf[off + 11] = 67;
    dbf[off + 16] = 10;
  });
  dbf[head - 1] = 13;
  dbf[head] = 32;
  dbf.write("101", head + 1);
  dbf[dbf.length - 1] = 26;
  const parts: Record<string, Uint8Array> = {
    ".shp": shp,
    ".shx": shx,
    ".dbf": dbf,
    ".cpg": Buffer.from("UTF-8"),
    ".prj": Buffer.from(
      'NAD_1983_StatePlane_Texas_Central_FIPS_4203_Feet UNIT["Foot_US",0.3048006096012192]',
    ),
    ".shp.xml": Buffer.from("<metadata/>"),
  };
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [ext, data] of Object.entries(parts))
    await writer.add(
      badName && ext === ".dbf" ? badName : "Election_Precincts" + ext,
      new Uint8ArrayReader(data),
      { level: 0 },
    );
  return Buffer.from(await writer.close());
}
test("validates all six original components with reconciled IDs, native geometry and CRC without extraction", async () => {
  const zip = await zipFixture();
  const result = await validateZip(zip, zip.length);
  expect(result.ids).toEqual(["101"]);
  expect(result.records).toBe(1);
  expect(result.members).toHaveLength(6);
  await expect(
    validateZip(zip.subarray(0, zip.length - 10), zip.length - 10),
  ).rejects.toThrow();
  const unsafe = await zipFixture("../unsafe.dbf");
  await expect(validateZip(unsafe, unsafe.length)).rejects.toThrow(
    "unsafe ZIP member",
  );
  const corrupt = Buffer.from(zip);
  corrupt[corrupt.indexOf(Buffer.from("<metadata/>"))] ^= 1;
  await expect(validateZip(corrupt, corrupt.length)).rejects.toThrow();
});
