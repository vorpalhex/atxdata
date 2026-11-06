import { createHash } from "node:crypto";
import { openSync, closeSync, fstatSync, readSync, constants } from "node:fs";
export const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function input(file: string, maxBytes: number): Buffer {
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("file_limit");
    const bytes = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (count !== stat.size) throw new Error("input_changed");
    return bytes.subarray(0, count);
  } finally {
    closeSync(fd);
  }
}
