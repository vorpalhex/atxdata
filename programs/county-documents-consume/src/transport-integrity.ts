import {transportUrl,type Source} from './adapters';
import {robotsDecision} from './human-policy';
import type {Engine} from "./engine";
import {sha} from "./engine";
import {verifySchema,readCooldown} from "./schema";
import {reservationReceipt,attemptReceipt} from './budgets';
import {verifyCooldownObligations} from './cooldown-integrity';
export type Representation={attempt:string;representation:string;encoding:string;wire_bytes:number|null;decoded_bytes:number;encoded_hash:string|null;decoded_hash:string;wire_path:string|null;decoded_path:string};
type Attempt={source:Source;id:string;run:string;run_kind:string;kind:string;url:string;status:number|null;error:string|null;bytes:number|null;sha:string|null;reservation:number;ended:number|null;headers:string|null};
function requireChecks(checks:boolean[],message:string):void {
 if(!checks.every(Boolean)) throw new Error(`transport integrity/budget: ${message}`);
}
function verifyLegacy(engine:Engine,a:Attempt,r:Representation):void {
 const resolution=engine.db.query<{evidence_hash:string;reason:string;previous_gate:string;resolved_at:number},[string]>("SELECT * FROM classifier_resolutions WHERE attempt=?").get(a.id);
 const h=new Headers(JSON.parse(a.headers!));
 requireChecks([a.kind==='robots',a.status===200,a.error==='Error: Content-Length mismatch',a.ended!==null,new URL(a.url).pathname==='/robots.txt',h.get('content-type')?.startsWith('text/plain')===true,['br','gzip'].includes(h.get('content-encoding')??''),r.encoding===h.get('content-encoding'),a.bytes===r.decoded_bytes,a.sha===r.decoded_hash,r.wire_bytes===null,r.encoded_hash===null,r.wire_path===null], 'legacy classifier failure identity');
 requireChecks([resolution!==null,resolution?.evidence_hash===r.decoded_hash,Boolean(resolution?.reason.trim()),Boolean(resolution?.previous_gate.trim()),(resolution?.resolved_at??0)>=a.ended!], 'legacy resolution evidence');
}
function verifyKnown(a:Attempt,r:Representation,blocked:boolean):void {
 requireChecks([r.representation==='encoded-and-decoded',a.bytes===r.wire_bytes,a.sha===r.encoded_hash,r.wire_path===`${r.encoded_hash}.wire`,Number.isInteger(r.wire_bytes),r.wire_bytes!>=0,r.wire_bytes!<=a.reservation], 'wire accounting');
 requireChecks([a.status!==null,a.status===200 || a.error!==null,a.ended!==null || blocked,a.error===null || blocked], 'status/error/stop accounting');
}
function verifyDecision(engine:Engine,a:Attempt,receipt:ReturnType<typeof reservationReceipt>):void {
 if(!receipt) return;
 if(a.kind==='robots') {requireChecks([receipt.acknowledgement===undefined], 'robots acknowledgement forbidden');return;}
 const robots=engine.db.query<{body:string;sha:string},[string]>('SELECT * FROM robots WHERE origin=?').get(new URL(a.url).origin);
 requireChecks([robots!==null], 'attempt robots provenance missing');
 const expected=robotsDecision(robots!.body,robots!.sha,a.url,receipt.acknowledgement?.human===true).acknowledgement;
 requireChecks([JSON.stringify(receipt.acknowledgement)===JSON.stringify(expected)], 'human acknowledgement provenance');
}
function verifyAttempt(engine:Engine,a:Attempt,blocked:boolean):void {
 const cap=a.reservation;
 const receipt=attemptReceipt(a);
 verifyDecision(engine,a,receipt);
 const r=engine.db.query<Representation,[string]>("SELECT * FROM representations WHERE attempt=?").get(a.id);
 if(!r) {
  requireChecks([a.bytes===null,a.sha===null,blocked,a.ended===null || a.error!==null], 'missing representation or unstopped unknown body');
  return;
 }
 requireChecks([Number.isInteger(r.decoded_bytes),r.decoded_bytes>=0,r.decoded_bytes<=cap,/^[a-f0-9]{64}$/.test(r.decoded_hash)], 'decoded accounting');
 if(r.representation==='legacy-decoded-only') verifyLegacy(engine,a,r);
 else verifyKnown(a,r,blocked);
}
function verifyRobots(engine:Engine):void {
 const rows=engine.db.query<{origin:string;body:string;sha:string},[]>("SELECT * FROM robots").all();
 for(const r of rows) {
  const receipt=engine.db.query("SELECT 1 FROM attempts a JOIN representations r ON r.attempt=a.id WHERE a.kind='robots' AND a.url=? AND a.status=200 AND r.decoded_hash=?").get(r.origin+'/robots.txt',r.sha);
  requireChecks([sha(r.body)===r.sha,receipt!==null], 'robots provenance');
 }
 const missing=engine.db.query("SELECT 1 FROM attempts a JOIN representations r ON r.attempt=a.id LEFT JOIN robots b ON a.url=b.origin||'/robots.txt' AND b.sha=r.decoded_hash WHERE a.kind='robots' AND (a.error IS NULL OR r.representation='legacy-decoded-only') AND a.ended IS NOT NULL AND b.origin IS NULL LIMIT 1").get();
 requireChecks([missing===null], 'robots decision missing');
}
export function verifyTransportLedger(engine:Engine,pendingClassifier?:string):void {
 verifySchema(engine.db);
 const gate=readCooldown(engine.db);
 const orphan=engine.db.query("SELECT 1 FROM classifier_resolutions c LEFT JOIN representations r ON r.attempt=c.attempt WHERE r.representation IS NULL OR r.representation<>'legacy-decoded-only' LIMIT 1").get();
 requireChecks([orphan===null], 'orphan classifier resolution');
 const attempts=engine.db.query<Attempt,[]>("SELECT a.*,r.kind run_kind,r.source FROM attempts a JOIN runs r ON a.run=r.id ORDER BY a.rowid").all();
 for(const a of attempts) {
  transportUrl(a.source,a.url,a.kind);
  if(a.id!==pendingClassifier) {verifyAttempt(engine,a,Boolean(gate!.blocked));continue;}
  const headers=new Headers(JSON.parse(a.headers!));
  requireChecks([Boolean(gate.blocked),a.kind==='robots',a.run_kind==='robots',a.status===200,a.error==='Error: Content-Length mismatch',a.ended!==null,a.bytes!==null,a.bytes!<=3145728,/^[a-f0-9]{64}$/.test(a.sha!),headers.get('content-type')?.startsWith('text/plain')===true,['br','gzip'].includes(headers.get('content-encoding')??''),engine.db.query('SELECT 1 FROM representations WHERE attempt=?').get(a.id)===null], 'pending classifier identity');
  reservationReceipt(a.run_kind,a.kind,a.reservation);
 }
 verifyOperations(attempts);
 verifyRobots(engine);
 verifyCooldownObligations(engine,gate.not_before);
}
function verifyOperations(attempts:Attempt[]):void {
 const operations=new Map<string,{n:number;bytes:number;limits:string}>();
 for(const attempt of attempts) {
  const receipt=reservationReceipt(attempt.run_kind,attempt.kind,attempt.reservation);
  if(!receipt) continue;
  const limits=JSON.stringify(receipt.limits),previous=operations.get(receipt.operation)??{n:0,bytes:0,limits};
  const expected=attempt.kind==='pdf'?Math.min(receipt.limits.maxPdfBytes,receipt.limits.maxBytes-previous.bytes):3145728;
  requireChecks([attempt.reservation===expected], 'exact operation reservation mismatch');
  previous.n++;previous.bytes+=attempt.bytes??attempt.reservation;
  requireChecks([previous.limits===limits,previous.n<=receipt.limits.maxRequests,previous.bytes<=receipt.limits.maxBytes], 'operation accounting mismatch');
  operations.set(receipt.operation,previous);
 }
}
