import type { Database } from "bun:sqlite";
import { archiveVersion } from "./schema";
export type Producing = { schema: 1; origin: string; attempt: string | null };
type Artifact = {
  source: string;
  url: string;
  sha: string;
  headers: string | null;
};
export function requireProducing(
  db: Database,
  artifact: Artifact,
  ref: Producing,
  kind: "page" | "pdf",
): void {
  if (
    !ref ||
    ref.schema !== 1 ||
    typeof ref.origin !== "string" ||
    !ref.origin.trim()
  )
    throw Error("producing reference required; operator review");
  if (ref.origin !== "live-http") {
    if (ref.attempt !== null)
      throw Error("imported producing reference cannot claim HTTP");
    return;
  }
  requireLiveProducing(db, artifact, ref.attempt!, kind);
}
function requireLiveProducing(
  db: Database,
  artifact: Artifact,
  attempt: string,
  kind: "page" | "pdf",
): void {
  const a = db
    .query<
      {
        source: string;
        url: string;
        kind: string;
        status: number;
        ended: number | null;
        error: string | null;
        headers: string;
        decoded_hash: string;
        run_status: string;
        run_error: string | null;
      },
      [string]
    >(
      `SELECT r.source,a.url,a.kind,a.status,a.ended,a.error,a.headers,p.decoded_hash,r.status run_status,r.error run_error FROM attempts a JOIN runs r ON r.id=a.run JOIN representations p ON p.attempt=a.id WHERE a.id=?`,
    )
    .get(attempt);
  if (!a) throw Error("producing attempt missing; operator review");
  const mime = new Headers(JSON.parse(a.headers)).get("content-type") ?? "";
  const checks = [
    a.source === artifact.source,
    a.url === artifact.url,
    a.kind === kind,
    a.status === 200,
    a.ended !== null,
    a.error === null,
    a.run_status === "complete",
    a.run_error === null,
    a.headers === artifact.headers,
    a.decoded_hash === artifact.sha,
    (kind === "pdf" ? /^application\/pdf(?:;|$)/i : /^text\/html(?:;|$)/i).test(
      mime,
    ),
  ];
  if (!checks.every(Boolean))
    throw Error(
      "producing attempt source/URL/status/headers/MIME/decoded identity mismatch",
    );
}
export function verifyProducing(db: Database): void {
  const version = archiveVersion(db);
  if (version === 3) return; // Genuine County format: retain its original, weaker interpretation.
  if (version === 4) {
    if (
      db
        .query(
          "SELECT 1 FROM snapshots WHERE origin='live-http' UNION ALL SELECT 1 FROM history WHERE origin='live-http' LIMIT 1",
        )
        .get()
    )
      throw Error(
        "schema4 live producing references absent; operator review required; no retrofit",
      );
    return;
  }
  const snapshots = db
    .query<Artifact & { id: string; origin: string }, []>(
      "SELECT s.*,m.headers FROM snapshots s JOIN snapshot_metadata m ON m.snapshot=s.id",
    )
    .all();
  for (const s of snapshots) {
    const ref = db
      .query<Producing, [string]>(
        "SELECT schema,origin,attempt FROM snapshot_producers WHERE snapshot=?",
      )
      .get(s.id);
    if (!ref || ref.origin !== s.origin)
      throw Error("snapshot producing reference missing/mismatch");
    requireProducing(db, s, ref, "page");
  }
  const receipts = db
    .query<{ source: string; url: string; sha: string; receipt: string }, []>(
      "SELECT * FROM validation_history",
    )
    .all();
  for (const row of receipts) {
    const receipt = JSON.parse(row.receipt);
    requireProducing(
      db,
      { ...row, headers: receipt.headers },
      receipt.producing,
      "pdf",
    );
  }
}
export function requireLiveFormat(db: Database, origin: string): void {
  if (origin === "live-http" && archiveVersion(db) !== 5)
    throw Error(
      "live producing references require new schema5 archive; operator review; no retrofit",
    );
}
export function producingReference(
  origin: string,
  attempt?: string,
): Producing {
  if ((origin === "live-http") !== (typeof attempt === "string"))
    throw Error("live producing attempt required; imports remain distinct");
  return { schema: 1, origin, attempt: attempt ?? null };
}
