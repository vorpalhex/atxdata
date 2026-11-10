import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Isolated state follows TMPDIR; never create generated data in the checkout. */
export function makeTestDirectory(prefix: string): string {
  const root = tmpdir();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, prefix));
}
