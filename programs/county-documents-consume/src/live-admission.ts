import { Database } from "bun:sqlite";
import { join } from "node:path";
import { statFile } from "../../civicclerk-consume/src/archive";
import { select, type Source, type Selection, type Evidence } from "./adapters";
import { verifySchema } from "./schema";
import { requireLiveFormat } from "./producing-integrity";
type Selected = Evidence & { status: string; adapterSchema: number };
function selected(db: Database, source: Source, scope: Selection): Selected[] {
  const rows = db
    .query<
      { evidence: string; status: string; adapter_schema: number },
      [string]
    >(
      "SELECT o.evidence,o.status,m.adapter_schema FROM observations o JOIN snapshot_metadata m ON m.snapshot=o.snapshot WHERE o.source=? ORDER BY o.rowid DESC",
    )
    .all(source);
  return select(
    rows.map((r) => ({
      ...JSON.parse(r.evidence),
      status: r.status,
      adapterSchema: r.adapter_schema,
    })),
    scope,
  ) as Selected[];
}
function current(rows: Selected[]): void {
  if (
    rows.some(
      (row) =>
        row.source === "austin-financial-publications" &&
        row.adapterSchema !== 5,
    )
  )
    throw Error(
      "Austin new PDF acquisition requires metadata5; legacy metadata4 is read-only",
    );
}
function imported(db: Database, id: string): void {
  const row = db
    .query<{ source: Source; adapter_schema: number }, [string]>(
      "SELECT o.source,m.adapter_schema FROM observations o JOIN snapshot_metadata m ON m.snapshot=o.snapshot WHERE o.id=?",
    )
    .get(id);
  if (
    row?.source === "austin-financial-publications" &&
    row.adapter_schema !== 5
  )
    throw Error(
      "Austin new PDF acquisition requires metadata5; legacy metadata4 is read-only",
    );
}
function offlineOrCurrent(
  db: Database,
  command: string,
  source?: Source,
  scope?: Selection,
): boolean {
  if (!["collect", "sync"].includes(command)) return false;
  const rows = selected(db, source!, scope!);
  if (command === "collect" && rows.every((row) => row.status === "downloaded"))
    return true;
  return false;
}
/** Admit new acquisition before writer lock/transport; legacy all-cache collect stays offline. */
export async function admitLive(
  root: string,
  command: string,
  source?: Source,
  scope?: Selection,
  observation?: string,
): Promise<void> {
  if (
    !["discover", "collect", "sync", "archive", "import-pdf"].includes(command)
  )
    return;
  if (!(await statFile(join(root, "documents.sqlite")))) return;
  const db = new Database(join(root, "documents.sqlite"), {
    readonly: true,
    strict: true,
  });
  try {
    verifySchema(db);
    if (command === "import-pdf") {
      imported(db, observation!);
      return;
    }
    if (offlineOrCurrent(db, command, source, scope)) return;
    requireLiveFormat(db, "live-http");
    if (["collect", "sync"].includes(command))
      current(selected(db, source!, scope!));
  } finally {
    db.close();
  }
}
