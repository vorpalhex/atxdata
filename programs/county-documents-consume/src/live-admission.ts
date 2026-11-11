import { Database } from "bun:sqlite";
import { join } from "node:path";
import { statFile } from "../../civicclerk-consume/src/archive";
import { select, type Source, type Selection } from "./adapters";
import { verifySchema } from "./schema";
import { requireLiveFormat } from "./producing-integrity";

/** Admit requested acquisition before opening a writer; all-cache collect is offline. */
export async function admitLive(
  root: string,
  command: string,
  source?: Source,
  scope?: Selection,
): Promise<void> {
  if (!["discover", "collect", "sync", "archive"].includes(command)) return;
  if (!(await statFile(join(root, "documents.sqlite")))) return;
  const db = new Database(join(root, "documents.sqlite"), {
    readonly: true,
    strict: true,
  });
  try {
    verifySchema(db);
    if (command === "collect") {
      const rows = db
        .query<{ evidence: string; status: string }, [string]>(
          "SELECT evidence,status FROM observations WHERE source=? ORDER BY rowid DESC",
        )
        .all(source!);
      const selected = select(
        rows.map((row) => ({
          ...JSON.parse(row.evidence),
          status: row.status,
        })),
        scope!,
      );
      if (
        selected.every(
          (row) =>
            (row as typeof row & { status: string }).status === "downloaded",
        )
      )
        return;
    }
    requireLiveFormat(db, "live-http");
  } finally {
    db.close();
  }
}
