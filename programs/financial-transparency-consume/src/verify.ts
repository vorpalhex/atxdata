import { withLock } from "./archive";
import { openStore } from "./store";
import { input, sha256 } from "./files";
import { decode, type Row } from "./csv";
import { sourceURL, positiveInteger, type Batch } from "./model";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
export function summary(db: Database) {
  const counts = db
    .query<
      { batches: number; rowsRead: number; accepted: number; rejected: number },
      []
    >("SELECT count(*) AS batches,coalesce(sum(rowsRead),0) AS rowsRead,coalesce(sum(accepted),0) AS accepted,coalesce(sum(rejected),0) AS rejected FROM batches")
    .get()!;
  return {
    ...counts,
    status: counts.rejected ? "imported_with_rejections" : "imported",
  };
}
function original(output: string, batch: Batch): Buffer {
  positiveInteger(batch.fiscalYear);
  positiveInteger(batch.bytes);
  if (
    batch.sourceURL !== sourceURL ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(batch.importedAt) ||
    isNaN(Date.parse(batch.importedAt))
  )
    throw new Error("metadata_mismatch");
  const bytes = input(join(output, batch.fileSHA256 + ".csv"), batch.bytes);
  if (bytes.length !== batch.bytes || sha256(bytes) !== batch.fileSHA256)
    throw new Error("original_mismatch");
  return bytes;
}
function verifyRows(db: Database, batch: Batch, decoded: Row[]): void {
  const rows = db
    .query<
      {
        ordinal: number;
        fields: string;
        cents: string | null;
        reason: string | null;
      },
      [string]
    >(
      "SELECT ordinal,fields,cents,reason FROM rows WHERE batch=? ORDER BY ordinal",
    )
    .all(batch.fileSHA256);
  if (rows.length !== decoded.length) throw new Error("row_count_mismatch");
  decoded.forEach((row, i) => {
    const stored = rows[i];
    if (
      stored.ordinal !== row.ordinal ||
      stored.fields !== JSON.stringify(row.fields) ||
      stored.cents !== row.cents ||
      stored.reason !== row.reason
    )
      throw new Error("row_mismatch");
  });
}
function verifyBatch(db: Database, output: string, batch: Batch): void {
  const decoded = decode(original(output, batch), batch.fiscalYear);
  verifyRows(db, batch, decoded);
  const rejected = decoded.filter((row) => row.reason !== null).length;
  if (
    batch.rowsRead !== decoded.length ||
    batch.accepted !== decoded.length - rejected ||
    batch.rejected !== rejected ||
    batch.status !== (rejected ? "imported_with_rejections" : "imported")
  )
    throw new Error("counter_mismatch");
}
export function verifyDatabase(db: Database, output: string): void {
  if (
    (db.query("PRAGMA integrity_check").get() as { integrity_check: string })
      .integrity_check !== "ok" ||
    db.query("PRAGMA foreign_key_check").all().length !== 0
  )
    throw new Error("integrity_failed");
  db.query<Batch, []>("SELECT * FROM batches ORDER BY fileSHA256")
    .all()
    .forEach((batch) => verifyBatch(db, output, batch));
}
export function verifyArchive(output: string) {
  return withLock(output, () => {
    const db = openStore(output, false);
    try {
      verifyDatabase(db, output);
      return { integrity: "ok", ...summary(db) };
    } finally {
      db.close();
    }
  });
}
export const statusArchive = verifyArchive;
