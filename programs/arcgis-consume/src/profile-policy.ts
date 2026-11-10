import type {Archive} from "./archive";
import {ensure,object} from "./check";

// RFC9309 2.3.1.3, explicitly approved only for these source profiles.
// This is an unavailable policy receipt, never a successful robots body.
function admitted(a:Archive,run:string,url:string) {
  const source=a.store.options(run)?.source;
  return (source==="austin" && url==="https://services.arcgis.com/robots.txt") ||
    (source==="water" && url==="https://services1.arcgis.com/robots.txt");
}
export function unavailablePolicy(a:Archive,run:string,url:string) {
  if(!admitted(a,run,url)) return;
  a.store.notBefore(); // provider validates timing/holds/manual stops; never reset.
  const label="robots-"+new URL(url).hostname;
  const rows=a.store.db.query<{id:string;label:string;url:string;status:number|null;finished:string|null;error:string|null;bytes:number},[string,string]>("SELECT id,label,url,status,finished,error,bytes FROM attempts WHERE run=? AND label=? ORDER BY started,id").all(run,label);
  const failures=rows.filter(row=>row.status===403);
  for(const row of failures) ensure(row.url===url && typeof row.finished==="string" && row.error==="HTTP 403" && row.bytes===0,"invalid unavailable robots attempt binding");
  const row=failures.at(-1);
  if(!row) return;
  return {version:1,kind:"robots-unavailable",attempt:row.id,label,url,status:403,bodyRetained:false};
}
export function sourcePolicy(a:Archive,run:string) {
  const source=a.store.options(run)?.source;
  if(source!=="austin" && source!=="water") return {};
  const url=source==="austin" ? "https://services.arcgis.com/robots.txt" : "https://services1.arcgis.com/robots.txt";
  const outcome=unavailablePolicy(a,run,url);
  return {sourcePolicy:{version:1,unavailable:outcome?[outcome]:[]}};
}
