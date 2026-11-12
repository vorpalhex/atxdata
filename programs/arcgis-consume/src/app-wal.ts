import { ensure } from "./check";
const cap = 64 * 1024 * 1024;
function checksum(
  raw: Buffer,
  little: boolean,
  seed: [number, number] = [0, 0],
): [number, number] {
  ensure(raw.length % 8 === 0, "unaligned WAL checksum input");
  let [a, b] = seed;
  const word = (offset: number) =>
    little ? raw.readUInt32LE(offset) : raw.readUInt32BE(offset);
  for (let i = 0; i < raw.length; i += 8) {
    a = (a + word(i) + b) >>> 0;
    b = (b + word(i + 4) + a) >>> 0;
  }
  return [a, b];
}
function pageSize(db: Buffer) {
  ensure(
    db.length >= 100 && db.subarray(0, 16).toString() === "SQLite format 3\0",
    "invalid readonly SQLite snapshot header",
  );
  const n = db.readUInt16BE(16);
  const size = n === 1 ? 65536 : n;
  ensure(
    size >= 512 &&
      size <= 65536 &&
      (size & (size - 1)) === 0 &&
      db.length % size === 0,
    "invalid readonly page size",
  );
  return size;
}
function walHeader(wal: Buffer, size: number) {
  ensure(wal.length >= 32, "truncated WAL header");
  const magic = wal.readUInt32BE(0);
  ensure(magic === 0x377f0682 || magic === 0x377f0683, "invalid WAL magic");
  ensure(
    wal.readUInt32BE(4) === 3007000 && wal.readUInt32BE(8) === size,
    "unsupported WAL format/page size",
  );
  const little = magic === 0x377f0682;
  const sum = checksum(wal.subarray(0, 24), little);
  ensure(
    sum[0] === wal.readUInt32BE(24) && sum[1] === wal.readUInt32BE(28),
    "WAL header checksum mismatch",
  );
  return { little, sum, salt: wal.subarray(16, 24) };
}
type Frame = { page: number; commit: number; data: Buffer };
function frames(wal: Buffer, size: number) {
  const h = walHeader(wal, size);
  ensure(
    (wal.length - 32) % (24 + size) === 0,
    "incomplete WAL frame snapshot",
  );
  const result: Frame[] = [];
  let sum = h.sum;
  for (let off = 32; off < wal.length; off += 24 + size) {
    const header = wal.subarray(off, off + 24),
      data = wal.subarray(off + 24, off + 24 + size);
    ensure(
      header.subarray(8, 16).equals(h.salt),
      "WAL generation changed/unknown tail",
    );
    const page = header.readUInt32BE(0),
      commit = header.readUInt32BE(4);
    ensure(
      page > 0 && page * size <= cap && commit * size <= cap,
      "WAL page bound exceeded",
    );
    sum = checksum(
      data,
      h.little,
      checksum(header.subarray(0, 8), h.little, sum),
    );
    ensure(
      sum[0] === header.readUInt32BE(16) && sum[1] === header.readUInt32BE(20),
      "WAL frame checksum mismatch",
    );
    result.push({ page, commit, data });
  }
  return result;
}
function snapshotBounds(db: Buffer, wal: Buffer | undefined) {
  ensure(
    db.length <= cap && (wal?.length ?? 0) <= cap,
    "readonly SQLite snapshot exceeds bounded memory",
  );
}
function committedFrames(wal: Buffer | undefined, size: number) {
  const all = wal?.length ? frames(wal, size) : [];
  let last = -1;
  for (let i = 0; i < all.length; i++) if (all[i]!.commit > 0) last = i;
  return all.slice(0, last + 1);
}
export function readonlySQLiteImage(db: Buffer, wal?: Buffer) {
  snapshotBounds(db, wal);
  const size = pageSize(db),
    committed = committedFrames(wal, size);
  const last = committed[committed.length - 1];
  const pages = last ? last.commit : db.length / size;
  ensure(
    pages > 0 && pages * size <= cap,
    "invalid committed WAL database size",
  );
  const image = Buffer.alloc(pages * size);
  db.copy(image, 0, 0, Math.min(db.length, image.length));
  for (const f of committed)
    if (f.page <= pages) f.data.copy(image, (f.page - 1) * size);
  // Snapshot normalization is memory-only. Never write this view to an archive.
  image[18] = 1;
  image[19] = 1;
  image.writeUInt32BE(pages, 28);
  return image;
}
