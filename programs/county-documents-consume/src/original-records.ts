import type { Database } from "bun:sqlite";
/** Virtual original-only status; physical5 observation CHECK is unchanged. */
export function originalStatus(
  db: Database,
  id: string,
  status: string,
): string {
  if (status !== "downloaded") return status;
  const versions = db
    .query<{ validation: string }, [string]>(
      "SELECT v.validation FROM history h JOIN versions v ON v.source=h.source AND v.url=h.url AND v.sha=h.sha WHERE h.observation=?",
    )
    .all(id);
  return versions.some((v) => {
    try {
      return JSON.parse(v.validation).schema === 9;
    } catch {
      return false;
    }
  })
    ? "captured"
    : status;
}
