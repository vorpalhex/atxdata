import type {Engine} from "./engine";
import {sha} from "./engine";
import {consumeEncoded} from "./encoding";
import {officialUrl,sources,type Source} from "./adapters";
import {verifyTransportLedger,type Representation} from "./transport-integrity";
export async function verifyArtifacts(engine:Engine):Promise<void> {
 const rows=engine.db.query<{path:string;sha:string;bytes:number;status:string},[]>("SELECT * FROM artifact_checkpoints").all();
 for(const row of rows) {
  if(row.status!=="promoted") throw new Error("unfinished artifact checkpoint");
  const bytes=await engine.readArtifact(row.path);
  if(sha(bytes)!==row.sha || bytes.length!==row.bytes) throw new Error("artifact checkpoint hash/size mismatch");
 }
}
function representationAttempt(engine:Engine,row:Representation) {
 const attempt=engine.db.query<{url:string;kind:string;headers:string;error:string|null;source:Source},[string]>("SELECT a.*,r.source FROM attempts a JOIN runs r ON a.run=r.id WHERE a.id=?").get(row.attempt);
 if(!attempt) throw new Error("representation attempt missing");
 officialUrl(attempt.source,attempt.url,sources[attempt.source].pages[0]);
 return attempt;
}
async function verifyLegacy(engine:Engine,row:Representation):Promise<void> {
 const resolution=engine.db.query("SELECT 1 FROM classifier_resolutions WHERE attempt=? AND evidence_hash=?").get(row.attempt,row.decoded_hash);
 const checks=[resolution!==null,row.wire_bytes===null,row.encoded_hash===null,row.wire_path===null];
 if(!checks.every(Boolean)) throw new Error("legacy decoded-only representation mismatch");
}
async function verifyWire(engine:Engine,row:Representation,headers:Headers,limit:number,body:Buffer):Promise<void> {
 if(row.wire_path===null) throw new Error("wire artifact missing");
 const wire=await engine.readArtifact(row.wire_path);
 if(wire.length!==row.wire_bytes || sha(wire)!==row.encoded_hash) throw new Error("encoded representation mismatch");
 const decoded=await consumeEncoded(new Response(new Uint8Array(wire),{headers}),limit);
 if(decoded.encoding!==row.encoding || !decoded.body.equals(body)) throw new Error("decoded representation mismatch");
}
export async function verifyRepresentations(engine:Engine):Promise<void> {
 verifyTransportLedger(engine);
 const rows=engine.db.query<Representation,[]>("SELECT * FROM representations").all();
 for(const row of rows) {
  const attempt=representationAttempt(engine,row),body=await engine.readArtifact(row.decoded_path);
  if(body.length!==row.decoded_bytes || sha(body)!==row.decoded_hash) throw new Error("decoded representation hash/size mismatch");
  if(row.representation==="legacy-decoded-only") await verifyLegacy(engine,row);
  else await verifyWire(engine,row,new Headers(JSON.parse(attempt.headers)),attempt.kind==="pdf"?5*1024*1024:3*1024*1024,body);
 }
}
