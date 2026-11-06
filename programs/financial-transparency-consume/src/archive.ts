import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  realpathSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
function checkDirectory(dir: string, privateRoot: boolean): void {
  const stat = lstatSync(dir);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    existsSync(join(dir, ".git"))
  )
    throw new Error("unsafe_archive");
  if (
    privateRoot &&
    (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)
  )
    throw new Error("private_archive_required");
}
export function archivePath(output: string): void {
  if (!isAbsolute(output) || realpathSync(output) !== output)
    throw new Error("unsafe_archive");
  let dir = output;
  for (;;) {
    checkDirectory(dir, dir === output);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
export function privateFile(path: string): void {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid!() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("unsafe_artifact");
}
export function withLock<T>(output: string, action: () => T): T {
  archivePath(output);
  const path = join(output, ".lock");
  const fd = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  const own = fstatSync(fd);
  closeSync(fd);
  try {
    return action();
  } finally {
    const current = lstatSync(path);
    if (current.ino === own.ino && current.dev === own.dev) unlinkSync(path);
  }
}
export function artifacts(output: string, hashes: string[]): void {
  const allowed = new Set([
    ".lock",
    "state.sqlite",
    ...hashes.map((h) => h + ".csv"),
  ]);
  for (const name of readdirSync(output)) {
    if (!allowed.has(name)) throw new Error("orphan_or_unknown_artifact");
    privateFile(join(output, name));
  }
}
