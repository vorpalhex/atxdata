import {
  ZipReader,
  Uint8ArrayReader,
  type Entry,
  configure,
} from "@zip.js/zip.js";
import { ensure, integer } from "./check";
import { validateRing } from "./geometry";
configure({ useWebWorkers: false });
export const dbfFields = [
  "Precinct",
  "VoterCount",
  "Congressio",
  "Senate",
  "Legislativ",
  "Commission",
  "JPConstabl",
  "StateBoard",
  "Creator",
  "Created",
  "LastEditor",
  "LastEdited",
];
const expected = [".cpg", ".dbf", ".prj", ".shp", ".shp.xml", ".shx"].map(
  (ext) => "Election_Precincts" + ext,
);
function dbfRecords(dbf: Buffer) {
  ensure(dbf.length >= 33, "truncated DBF");
  const count = integer(dbf.readUInt32LE(4), 1, 1000),
    head = dbf.readUInt16LE(8),
    size = dbf.readUInt16LE(10);
  ensure(
    head === 32 + 32 * dbfFields.length + 1 &&
      dbf[head - 1] === 13 &&
      dbf.length >= head + size * count &&
      dbf.length <= head + size * count + 1,
    "DBF length/schema mismatch",
  );
  let offset = 1;
  const schema = dbfFields.map((name, i) => {
    const start = 32 + i * 32,
      field = dbf
        .subarray(start, start + 11)
        .toString("ascii")
        .split("\0")[0],
      type = String.fromCharCode(dbf[start + 11]),
      length = dbf[start + 16];
    ensure(
      field === name && ["C", "N", "D", "F"].includes(type) && length > 0,
      "DBF field schema changed",
    );
    const result = { name, type, length, offset };
    offset += length;
    return result;
  });
  ensure(offset === size, "DBF record length mismatch");
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = head + i * size;
    ensure(dbf[start] === 32, "deleted/invalid DBF row");
    const id = dbf
      .subarray(
        start + schema[0].offset,
        start + schema[0].offset + schema[0].length,
      )
      .toString("ascii")
      .trim();
    ensure(/^\d+$/.test(id), "invalid precinct identity");
    ids.push(id);
  }
  ensure(new Set(ids).size === count, "duplicate precinct identities");
  return { count, ids, schema };
}
function shapeHeader(data: Buffer) {
  ensure(
    data.length >= 100 &&
      data.readInt32BE(0) === 9994 &&
      data.readInt32BE(24) * 2 === data.length &&
      data.readInt32LE(28) === 1000 &&
      data.readInt32LE(32) === 5,
    "invalid polygon shapefile header",
  );
  const extent = {
    xmin: data.readDoubleLE(36),
    ymin: data.readDoubleLE(44),
    xmax: data.readDoubleLE(52),
    ymax: data.readDoubleLE(60),
  };
  ensure(
    Object.values(extent).every(Number.isFinite) &&
      extent.xmin < extent.xmax &&
      extent.ymin < extent.ymax,
    "invalid shapefile extent",
  );
  return extent;
}
function shapeRecord(
  shp: Buffer,
  start: number,
  end: number,
  extent: Record<string, number>,
) {
  ensure(
    end - start >= 48 && shp.readInt32LE(start) === 5,
    "non-polygon/truncated shape",
  );
  const partCount = integer(shp.readInt32LE(start + 36), 1, 100000),
    points = integer(shp.readInt32LE(start + 40), 4, 125000);
  const pointsAt = start + 44 + partCount * 4;
  ensure(pointsAt + points * 16 === end, "shape record length mismatch");
  const parts = Array.from({ length: partCount }, (_, i) =>
    integer(shp.readInt32LE(start + 44 + i * 4), 0, points - 1),
  );
  ensure(
    parts[0] === 0 && parts.every((p, i) => i === 0 || p > parts[i - 1]),
    "invalid ring offsets",
  );
  for (let i = 0; i < parts.length; i++) {
    const stop = parts[i + 1] ?? points;
    const ring = Array.from({ length: stop - parts[i] }, (_, j) => {
      const off = pointsAt + (parts[i] + j) * 16;
      return [shp.readDoubleLE(off), shp.readDoubleLE(off + 8)];
    });
    validateRing(ring, extent);
  }
  return { rings: partCount, vertices: points };
}
function shapeRecords(shp: Buffer, shx: Buffer, count: number) {
  const extent = shapeHeader(shp);
  shapeHeader(shx);
  ensure(shx.length === 100 + count * 8, "SHP/SHX/DBF count mismatch");
  let next = 100,
    rings = 0,
    vertices = 0;
  for (let i = 0; i < count; i++) {
    const offset = shx.readInt32BE(100 + i * 8) * 2,
      length = shx.readInt32BE(104 + i * 8) * 2;
    ensure(
      offset === next && length > 0 && offset + 8 + length <= shp.length,
      "SHX offset/length mismatch",
    );
    ensure(
      shp.readInt32BE(offset) === i + 1 &&
        shp.readInt32BE(offset + 4) * 2 === length,
      "SHP record identity/length mismatch",
    );
    const result = shapeRecord(shp, offset + 8, offset + 8 + length, extent);
    rings += result.rings;
    vertices += result.vertices;
    next = offset + 8 + length;
  }
  ensure(next === shp.length, "unindexed SHP content");
  return { rings, vertices, extent };
}
function validateEntries(entries: Entry[]) {
  ensure(
    entries.length === 6 && new Set(entries.map((e) => e.filename)).size === 6,
    "ZIP member count/duplicates",
  );
  let expanded = 0;
  for (const entry of entries) {
    ensure(
      expected.includes(entry.filename) &&
        !entry.directory &&
        !entry.encrypted &&
        ((entry.externalFileAttributes >>> 16) & 0xf000) !== 0xa000,
      "unsafe ZIP member",
    );
    expanded += entry.uncompressedSize;
    ensure(
      Number.isSafeInteger(expanded) && expanded <= 2_000_000,
      "ZIP expansion ceiling",
    );
  }
}
async function decodeEntries(entries: Entry[]) {
  const parts = new Map<string, Buffer>();
  for (const entry of entries) {
    ensure(!entry.directory, "ZIP entry cannot be read");
    let size = 0;
    const chunks: Buffer[] = [];
    const sink = new WritableStream<Uint8Array>({
      write(chunk) {
        size += chunk.byteLength;
        ensure(
          size <= entry.uncompressedSize && size <= 2_000_000,
          "ZIP actual expansion ceiling",
        );
        chunks.push(Buffer.from(chunk));
      },
    });
    await entry.getData(sink, { checkSignature: true, useWebWorkers: false });
    ensure(size === entry.uncompressedSize, "ZIP expanded size mismatch");
    parts.set(entry.filename, Buffer.concat(chunks));
  }
  return parts;
}
export async function validateZip(raw: Uint8Array, expectedBytes: number) {
  ensure(
    raw.length === expectedBytes &&
      raw.length <= 1_000_000 &&
      Buffer.from(raw.subarray(0, 4)).equals(Buffer.from([80, 75, 3, 4])),
    "ZIP size/signature mismatch",
  );
  const reader = new ZipReader(new Uint8ArrayReader(raw), {
    checkSignature: true,
    useWebWorkers: false,
  });
  try {
    const entries = await reader.getEntries();
    validateEntries(entries);
    const parts = await decodeEntries(entries);
    const part = (ext: string) => parts.get("Election_Precincts" + ext)!;
    const prj = part(".prj").toString();
    ensure(
      prj.includes("NAD_1983_StatePlane_Texas_Central_FIPS_4203_Feet") &&
        prj.includes('UNIT["Foot_US",0.3048006096012192]'),
      "unexpected native PRJ",
    );
    ensure(
      /^(UTF-8|65001)$/i.test(part(".cpg").toString().trim()),
      "unsupported DBF encoding",
    );
    const dbf = dbfRecords(part(".dbf")),
      shapes = shapeRecords(part(".shp"), part(".shx"), dbf.count);
    return {
      records: dbf.count,
      ids: dbf.ids,
      schema: dbf.schema,
      members: entries.map((e) => ({
        name: e.filename,
        bytes: e.uncompressedSize,
        crc32: e.signature,
      })),
      ...shapes,
    };
  } finally {
    await reader.close();
  }
}
