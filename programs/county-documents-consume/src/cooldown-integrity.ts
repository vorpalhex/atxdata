import type {Engine} from './engine';
import {cooldown,robotsPolicy,RobotsDisallow} from './policy';
import {attemptReceipt} from './budgets';
export type HeaderTiming={clockBasis:'unix-ms';observed:number};
type Completion={id:string;run:string;run_kind:string;kind:string;reservation:number;url:string;started:number;ended:number|null;headers:string|null;error:string|null};
function timestamp(value:number):number {
 if(!Number.isSafeInteger(value) || value<0) throw Error('cooldown evidence timestamp invalid');
 return value;
}
function responseTime(a:Completion):number {
 const receipt=attemptReceipt(a);
 // Old receipts lack header time. Completion is a conservative upper bound for
 // relative holds, not a fabricated observation. Insufficient old gates refuse reviewably.
 if(!a.run.startsWith('transport-work-v2:')) return timestamp(a.ended!);
 const timing=receipt?.headerTiming;
 if(timing?.clockBasis!=='unix-ms') throw Error('cooldown header clock basis missing');
 const observed=timestamp(timing.observed);
 if(observed<a.started || observed>a.ended!) throw Error('cooldown header receipt outside attempt');
 return observed;
}
function robotsDelay(engine:Engine,url:string):number {
 const row=engine.db.query<{body:string},[string]>('SELECT body FROM robots WHERE origin=?').get(new URL(url).origin);
 if(!row) return 2000;
 try {return robotsPolicy(row.body,new URL(url).pathname);}
 catch(error) {if(error instanceof RobotsDisallow) return error.delay;throw error;}
}
function completionDeadline(engine:Engine,a:Completion):number {
 const ended=timestamp(a.ended!);
 if(ended<timestamp(a.started) || a.headers===null) throw Error('cooldown completion evidence invalid');
 const minimum=a.run.startsWith('transport-work-')?3000:2000;
 return Math.max(ended+Math.max(minimum,robotsDelay(engine,a.url)),cooldown(new Headers(JSON.parse(a.headers)),responseTime(a)));
}
function requireDeadline(gate:number,deadline:number):void {
 if(!Number.isSafeInteger(deadline) || gate<deadline) throw Error('cooldown below retained completion/receipt/robots obligation; operator review');
}
export function verifyCooldownObligations(engine:Engine,gate:number):void {
 const rows=engine.db.query<Completion,[]>("SELECT a.*,r.kind run_kind FROM attempts a JOIN runs r ON r.id=a.run WHERE a.ended IS NOT NULL AND (a.error IS NULL OR EXISTS(SELECT 1 FROM classifier_resolutions c WHERE c.attempt=a.id))").all();
 for(const a of rows) requireDeadline(gate,completionDeadline(engine,a));
 const robots=engine.db.query<{body:string;observed:number},[]>('SELECT body,observed FROM robots').all();
 for(const row of robots) requireDeadline(gate,timestamp(row.observed)+robotsPolicy(row.body,'/robots.txt'));
}
