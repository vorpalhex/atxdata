import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";

/** Isolated test state stays inside this program's ignored scratch directory. */
export function makeTestDirectory(prefix: string): string {
  const root = resolve(import.meta.dir, "../.scratch");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, prefix));
}
