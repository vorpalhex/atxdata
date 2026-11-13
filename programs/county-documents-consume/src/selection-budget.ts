import { originalStatus } from "./original-records";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { statFile } from "../../civicclerk-consume/src/archive";
import { select, type Source, type Selection, type Evidence } from "./adapters";
import type { WorkBudget } from "./budgets";
import { verifySchema } from "./schema";
async function retainedSize(
  root: string,
  version: { path: string; bytes: number },
  limit: number,
): Promise<number> {
  if (!/^[a-f0-9]{64}\.pdf$/.test(version.path))
    throw Error("unsafe artifact path");
  const size = (await statFile(join(root, version.path)))?.size;
  if (size !== version.bytes)
    throw Error("retained original byte identity mismatch");
  if (size > limit)
    throw Error("current caller PDF byte budget exceeded by retained original");
  return size;
}
/** Read-only current-operation admission, before writer acquisition or PDF parsing. */
export async function selectionBytes(
  root: string,
  source: Source,
  scope: Selection,
  limits: WorkBudget,
): Promise<number> {
  const exists = await statFile(join(root, "documents.sqlite"));
  if (!exists) return 0;
  const db = new Database(join(root, "documents.sqlite"), {
    readonly: true,
    strict: true,
  });
  try {
    verifySchema(db);
    const rows = db
      .query<{ id: string; evidence: string; status: string }, [string]>(
        "SELECT id,evidence,status FROM observations WHERE source=? ORDER BY rowid DESC",
      )
      .all(source);
    const selected = select(
      rows
        .map((row) => ({
          ...row,
          status: originalStatus(db, row.id, row.status),
        }))
        .filter((row) => scope.captureOnly || row.status !== "captured")
        .map((row) => ({
          ...JSON.parse(row.evidence),
          id: row.id,
          status: row.status,
        })),
      scope,
    ) as (Evidence & { id: string; status: string })[];
    let total = 0;
    for (const row of selected) {
      if (
        row.status !== "downloaded" &&
        !(scope.captureOnly && row.status === "captured")
      )
        continue;
      const versions = db
        .query<{ path: string; bytes: number }, [string]>(
          "SELECT v.path,v.bytes FROM history h JOIN versions v ON h.source=v.source AND h.url=v.url AND h.sha=v.sha WHERE h.observation=?",
        )
        .all(row.id);
      for (const version of versions) {
        total += await retainedSize(root, version, limits.maxPdfBytes);
        if (!Number.isSafeInteger(total) || total > limits.maxBytes)
          throw Error(
            "current caller aggregate byte budget exceeded by retained originals",
          );
      }
    }
    return total;
  } finally {
    db.close();
  }
}
