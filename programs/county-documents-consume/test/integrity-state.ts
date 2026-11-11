import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
export async function state(root: string) {
  const db = new Database(join(root, "documents.sqlite"), { readonly: true });
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all();
  const logical = Object.fromEntries(
    tables.map(({ name }) => [
      name,
      db.query(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ]),
  );
  db.close();
  const files: Record<string, string> = {};
  for (const name of (await readdir(root)).sort())
    if (name !== "documents.sqlite-shm")
      files[name] = createHash("sha256")
        .update(await readFile(join(root, name)))
        .digest("hex");
  return { logical, files };
}
