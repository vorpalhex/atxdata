import { withLock } from "./archive";
import { openStore } from "./store";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode } from "./csv";
import { input, sha256 } from "./files";
import { sourceURL, positiveInteger, type Options, type Batch } from "./model";
import { verifyDatabase } from "./verify";
export function importCsv(options: Options): Batch & { reused: boolean } {
  positiveInteger(options.fiscalYear);
  const maxBytes = positiveInteger(options.maxBytes ?? 104857600),
    maxRows = positiveInteger(options.maxRows ?? 1000000);
  const bytes = input(options.file, maxBytes),
    hash = sha256(bytes);
  const rows = decode(bytes, options.fiscalYear);
  if (rows.length > maxRows) throw new Error("row_limit");
  const rejected = rows.filter((row) => row.reason !== null).length;
  const batch: Batch = {
    fileSHA256: hash,
    fiscalYear: options.fiscalYear,
    importedAt: new Date().toISOString(),
    bytes: bytes.length,
    status: rejected ? "imported_with_rejections" : "imported",
    rowsRead: rows.length,
    accepted: rows.length - rejected,
    rejected,
    sourceURL,
  };
  return withLock(options.output, () => {
    const db = openStore(options.output, true);
    try {
      verifyDatabase(db, options.output);
      const prior = db
        .query<Batch, [string]>("SELECT * FROM batches WHERE fileSHA256=?")
        .get(hash);
      if (prior) {
        if (prior.fiscalYear !== options.fiscalYear)
          throw new Error("reuse_failed");
        return { ...prior, reused: true };
      }
      writeFileSync(join(options.output, hash + ".csv"), bytes, {
        flag: "wx",
        mode: 0o400,
      });
      db.transaction(() => {
        db.query("INSERT INTO batches VALUES(?,?,?,?,?,?,?,?,?)").run(
          batch.fileSHA256,
          batch.fiscalYear,
          batch.importedAt,
          batch.bytes,
          batch.status,
          batch.rowsRead,
          batch.accepted,
          batch.rejected,
          batch.sourceURL,
        );
        const insert = db.query("INSERT INTO rows VALUES(?,?,?,?,?)");
        rows.forEach((row) =>
          insert.run(
            hash,
            row.ordinal,
            JSON.stringify(row.fields),
            row.cents,
            row.reason,
          ),
        );
      }).immediate();
      return { ...batch, reused: false };
    } finally {
      db.close();
    }
  });
}
