import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { privateFile, artifacts } from "./archive";
const schema = [
  "CREATE TABLE batches(fileSHA256 TEXT PRIMARY KEY NOT NULL,fiscalYear INTEGER NOT NULL,importedAt TEXT NOT NULL,bytes INTEGER NOT NULL,status TEXT NOT NULL,rowsRead INTEGER NOT NULL,accepted INTEGER NOT NULL,rejected INTEGER NOT NULL,sourceURL TEXT NOT NULL)",
  "CREATE TABLE rows(batch TEXT NOT NULL REFERENCES batches(fileSHA256),ordinal INTEGER NOT NULL,fields TEXT NOT NULL,cents TEXT,reason TEXT,PRIMARY KEY(batch,ordinal))",
];
export function openStore(output: string, create: boolean): Database {
  const path = join(output, "state.sqlite"),
    fresh = !existsSync(path);
  if (fresh) {
    artifacts(output, []);
    if (!create) throw new Error("missing_database");
    closeSync(openSync(path, "wx", 0o600));
  }
  privateFile(path);
  const db = new Database(path, { strict: true });
  try {
    if (fresh)
      db.transaction(() => {
        schema.forEach((sql) => db.exec(sql));
        db.exec("PRAGMA application_id=1179931472; PRAGMA user_version=1");
      }).immediate();
    const tables = db
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
      )
      .all()
      .map((r) => r.sql);
    if (
      JSON.stringify(tables) !== JSON.stringify(schema) ||
      db.query<{ application_id: number }, []>("PRAGMA application_id").get()!
        .application_id !== 1179931472 ||
      db.query<{ user_version: number }, []>("PRAGMA user_version").get()!
        .user_version !== 1
    )
      throw new Error("schema_mismatch");
    db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=0",
    );
    const hashes = db
      .query<{ fileSHA256: string }, []>("SELECT fileSHA256 FROM batches")
      .all()
      .map((r) => r.fileSHA256);
    if (hashes.some((hash) => !/^([a-f0-9]{64})$/.test(hash)))
      throw new Error("invalid_hash");
    artifacts(output, hashes);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
