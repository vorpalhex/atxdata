export type EventContinuation = { version: 1; query: string; offset: number; ids: number[]; pageSize: number };
export type EventListingOptions = { maxPages?: number; pageSize?: number; continuation?: EventContinuation };
export function positiveLimit(value: number | undefined, fallback: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("invalid listing budget");
  return n;
}
export function calendarRange(from: string, to: string): string {
  for (const date of [from,to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new Error("invalid listing date");
  }
  if (from>to) throw new Error("reversed listing range");
  const end=new Date(`${to}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+1);
  return end.toISOString().slice(0,10);
}
function validateIdentity(query: string, pageSize: number, state: EventContinuation): void {
  if (state.version !== 1 || state.query !== query || state.pageSize !== pageSize) throw new Error("invalid event continuation");
}
export function listingState(query: string, pageSize: number, state?: EventContinuation): { offset:number; ids:Set<number> } {
  if (!state) return {offset:0,ids:new Set()};
  validateIdentity(query,pageSize,state);
  if (!Number.isSafeInteger(state.offset) || state.offset<0 || !Array.isArray(state.ids) || state.ids.some(id=>!Number.isSafeInteger(id)||id<=0) || new Set(state.ids).size!==state.ids.length || state.ids.length!==state.offset) throw new Error("invalid event continuation");
  return {offset:state.offset,ids:new Set(state.ids)};
}
