import type { DocumentManifestEntry } from "../types";

export function dedupeManifest(entries: DocumentManifestEntry[]): DocumentManifestEntry[] {
  const seen = new Set<string>();
  const deduped: DocumentManifestEntry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.sourceUrl)) continue;
    seen.add(entry.sourceUrl);
    deduped.push(entry);
  }

  return deduped;
}

