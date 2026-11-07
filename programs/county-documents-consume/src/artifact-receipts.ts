import type {Database} from 'bun:sqlite';
import {sha} from './engine';
type Receipt={sha:string;bytes:number;status:string};
export function requireArtifactReceipt(db:Database,path:string,body:Uint8Array):void {
 const expected={sha:sha(body),bytes:body.length};
 const checkpoint=db.query<Receipt,[string]>('SELECT * FROM artifact_checkpoints WHERE path=?').get(path);
 if(checkpoint) {
  if(checkpoint.status!=='promoted' || checkpoint.sha!==expected.sha || checkpoint.bytes!==expected.bytes) throw Error('artifact checkpoint identity mismatch');
  return;
 }
 const legacy=db.query<{sha:string;bytes:number;evidence:string},[string]>('SELECT * FROM legacy_artifacts WHERE path=?').get(path);
 if(!legacy) throw Error('required artifact checkpoint missing; explicit evidenced legacy migration required');
 const evidence=JSON.parse(legacy.evidence);
 const checks=[legacy.sha===expected.sha,legacy.bytes===expected.bytes,evidence.path===path,evidence.sha===legacy.sha,evidence.bytes===legacy.bytes,evidence.kind==='pre-checkpoint-artifact',/^[a-f0-9]{64}$/.test(evidence.priorArchiveSha256),typeof evidence.reason==='string' && evidence.reason.trim().length>0];
 if(!checks.every(Boolean)) throw Error('legacy artifact checkpoint exemption evidence mismatch');
}
