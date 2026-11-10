import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { StoredDocument } from "../storage/db";

function inside(root: string, path: string): void {
  const child = relative(resolve(root), resolve(path));
  if (
    !child ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error("cached document integrity: path outside document root");
  }
}

async function regularOriginal(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile()) {
      throw new Error(
        "cached document integrity: original is not a regular file",
      );
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

async function rejectSymlinkAncestors(path: string): Promise<void> {
  for (let current = dirname(resolve(path)); ; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error("cached document integrity: symlink ancestor");
    }
    if (dirname(current) === current) return;
  }
}

async function digest(
  path: string,
): Promise<{ bytes: number; sha256: string }> {
  const handle = await open(path, "r");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

/** Verify retained bytes before treating a repeat download as successful reuse. */
export async function cachedDocumentBytes(
  document: StoredDocument | null,
  root: string,
): Promise<number | undefined> {
  if (document?.downloadStatus !== "downloaded" || !document.storagePath)
    return;
  inside(root, document.storagePath);
  if (!(await regularOriginal(document.storagePath))) return;
  await rejectSymlinkAncestors(document.storagePath);
  const original = await digest(document.storagePath);
  if (
    original.sha256 !== document.sha256 ||
    (document.byteSize !== null && original.bytes !== document.byteSize)
  ) {
    throw new Error(
      "cached document integrity: checksum or byte size mismatch",
    );
  }
  return original.bytes;
}
