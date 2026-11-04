import { expect, test } from "bun:test";
import { archiveLock, promote } from "../src/archive";
import { realpath, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("lock release preserves a replacement owner and promotion never clobbers", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "civic-owner-"));
  try {
    const release = await archiveLock(root);
    await writeFile(join(root, ".civicclerk.lock"), "replacement"); await release();
    expect(await readFile(join(root, ".civicclerk.lock"), "utf8")).toBe("replacement");
    const path = join(root, "file.pdf"); await writeFile(path, "original"); await writeFile(`${path}.pending`, "new");
    await expect(promote(path)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("original"); expect(await readFile(`${path}.pending`, "utf8")).toBe("new");
  } finally { await rm(root, { recursive: true, force: true }); }
});
