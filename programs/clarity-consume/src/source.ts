import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
export const HOST = 'https://results.enr.clarityelections.com';
export const COUNTY = `${HOST}/TX/Travis/`;
export const OFFICIAL = 'https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms/';
export const CAPS = Object.freeze({ requests:15, files:15, fileBytes:12_000_000, totalBytes:20_000_000, decodedBytes:8*1024*1024, xmlBytes:32*1024*1024, catalog:100, rows:1_000_000 });
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
  token(entry.EID);sourceDate(entry.Date);
  if (typeof entry.ElectionName !== 'string' || typeof entry.Date !== 'string' || seen.has(entry.EID)) throw new Error('catalog identity/schema');
  seen.add(entry.EID);return entry;
}
/** Calendar arithmetic only: no timezone interpretation or rollover. */
export function isoDate(value:unknown):string {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('expected real calendar date YYYY-MM-DD');
  const [y,m,d]=value.split('-').map(Number);
  if(![y>=1,m>=1,m<=12,d>=1,d<=monthDays(y,m)].every(Boolean))throw new Error('expected real calendar date YYYY-MM-DD');return value;
}
function monthDays(year:number,month:number):number {
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  return [31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
}
export function sourceDate(value:unknown):string {
  const match=typeof value==='string'?/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: 12:00:00 AM)?$/.exec(value):null;
  if(!match)throw new Error('unsupported source election date; expected M/D/YYYY [12:00:00 AM]');
  return isoDate(`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`);
}
// Only errors created by selectDate carry a public selection diagnostic.
// Keep ordinary Error/message compatibility; never classify by message prefix.
const dateSelectionErrors = new WeakMap<object,string>();
export function dateSelectionDiagnostic(error:unknown):string|undefined {
  return error instanceof Error ? dateSelectionErrors.get(error) : undefined;
}
export function selectDate(entries:Election[],date:string):Election {
  const matches=entries.filter(e=>sourceDate(e.Date)===date);
  const candidates=(matches.length?matches:entries).map(e=>`${e.EID} (${sourceDate(e.Date)}: ${e.ElectionName})`).join(', ');
  if(matches.length!==1){
    const error=new Error(`${matches.length?'ambiguous':'nonexistent'} catalog date ${date}; candidates: ${candidates || 'none'}`);
    // Escape terminal controls in public catalog labels, without changing library errors.
    dateSelectionErrors.set(error,JSON.stringify(error.message).slice(1,-1));
    throw error;
  }
  return matches[0];
}
export function catalog(value: unknown): Election[] {
  if (!Array.isArray(value) || value.length > CAPS.catalog) throw new Error('catalog record ceiling/schema');
  const seen = new Set<string>();
  return value.map(entry=>electionEntry(entry,seen));
}
