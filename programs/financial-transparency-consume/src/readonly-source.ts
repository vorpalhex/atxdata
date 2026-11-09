import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
// SQLite's deserializer cannot read a serialized WAL-mode main database without
// its WAL sidecar. A closed, checkpointed archive can legitimately have none.
// Change only the two journal-format bytes of an IN-MEMORY copy to make that
// checkpoint readable. Do not repair/create files or ignore an existing WAL.
export function readonlySource(path: string) {
  if (existsSync(path + '-wal')) return new Database(path, {readonly:true,strict:true});
  const bytes = readFileSync(path);
  if (bytes[18] !== 2 || bytes[19] !== 2) return new Database(path,{readonly:true,strict:true});
  bytes[18] = 1;
  bytes[19] = 1;
  return Database.deserialize(bytes,{readonly:true,strict:true});
}
