import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
export const HOST = 'https://results.enr.clarityelections.com';
export const COUNTY = `${HOST}/TX/Travis/`;
export const OFFICIAL = 'https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms/';
export const CAPS = Object.freeze({ requests:15, files:15, fileBytes:12_000_000, totalBytes:20_000_000, decodedBytes:1_000_000, xmlBytes:100_000, catalog:100, rows:1000 });
export function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{1,20}$/.test(value)) throw new Error('expected literal digits-only source token');
  return value;
}
export function decode(raw: Buffer, encoding: string | null, limit:number = CAPS.decodedBytes) {
  if (encoding && encoding !== 'gzip' && encoding !== 'identity') throw new Error('unsupported content encoding');
  const bytes = encoding === 'gzip' ? gunzipSync(raw, { maxOutputLength:limit }) : raw;
  if (bytes.length > limit) throw new Error('decoded byte ceiling');
  return { bytes, encodedHash:hash(raw), decodedHash:hash(bytes) };
}
export type Election = { State:string; StateId:string; County:string; CountyId:string; EID:string; ElectionName:string; Date:string };
function electionEntry(entry:any,seen:Set<string>):Election {
  if (entry.State !== 'TX' || entry.StateId !== '9' || entry.County !== 'Travis' || entry.CountyId !== '1239') throw new Error('source jurisdiction mismatch');
  token(entry.EID);
  if (typeof entry.ElectionName !== 'string' || typeof entry.Date !== 'string' || seen.has(entry.EID)) throw new Error('catalog identity/schema');
  seen.add(entry.EID);return entry;
}
export function catalog(value: unknown): Election[] {
  if (!Array.isArray(value) || value.length > CAPS.catalog) throw new Error('catalog record ceiling/schema');
  const seen = new Set<string>();
  return value.map(entry=>electionEntry(entry,seen));
}
