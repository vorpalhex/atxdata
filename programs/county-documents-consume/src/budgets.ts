import type {HumanAcknowledgement} from './human-policy';
export type WorkBudget={maxRequests:number;maxBytes:number;maxPdfBytes:number;maxPages:number};
export const DEFAULT_PDF_BYTES=128*1024*1024;
export const DEFAULT_BUDGET:WorkBudget={maxRequests:100,maxBytes:512*1024*1024,maxPdfBytes:DEFAULT_PDF_BYTES,maxPages:50};
export function positiveBudget(value:number,name:string):number {
 if(!Number.isSafeInteger(value) || value<1) throw new Error(`invalid ${name} budget`);
 return value;
}
export function workBudget(options:Partial<WorkBudget>={}):WorkBudget {
 const result={...DEFAULT_BUDGET,...options};
 for(const [name,value] of Object.entries(result)) positiveBudget(value,name);
 return result;
}
/** One authorized operation only; durable attempts, cooldowns and stop gates are never reset. */
export class OperationBudget {
 readonly id=crypto.randomUUID();
 private requests=0;
 private bytes=0;
 readonly limits:WorkBudget;
 constructor(options:Partial<WorkBudget>={}) {this.limits=workBudget(options);}
 reserve(kind:string):number {
  const cap=kind==='pdf'?Math.min(this.limits.maxPdfBytes,this.limits.maxBytes-this.bytes):3*1024*1024;
  if(this.requests>=this.limits.maxRequests || cap<1 || cap>this.limits.maxBytes-this.bytes) throw new Error('operation request/byte budget exhausted');
  this.requests++;
  this.bytes+=cap;
  return cap;
 }
 complete(reservation:number,actual:number):void {this.bytes-=reservation-actual;}
 receipt(kind:string,cap:number,acknowledgement?:HumanAcknowledgement):string {return 'transport-work-v1:'+JSON.stringify({operation:this.id,kind,cap,limits:this.limits,acknowledgement});}
}
function legacyReservation(runKind:string,kind:string,cap:number):null {
 if(runKind!==kind || !['pdf','page','robots'].includes(kind) || cap!==(kind==='pdf'?5*1024*1024:3*1024*1024)) throw Error('legacy full reservation identity mismatch');
 return null;
}
export function reservationReceipt(runKind:string,kind:string,cap:number) {
 if(!runKind.startsWith('transport-work-v1:')) return legacyReservation(runKind,kind,cap);
 const receipt=JSON.parse(runKind.slice('transport-work-v1:'.length)) as {operation:string;kind:string;cap:number;limits:WorkBudget;acknowledgement?:HumanAcknowledgement};
 if(!receipt.limits || Object.keys(receipt.limits).sort().join(',')!=='maxBytes,maxPages,maxPdfBytes,maxRequests') throw Error('operation limits identity mismatch');
 const limits=workBudget(receipt.limits);
 const checks=[/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(receipt.operation),receipt.kind===kind,receipt.cap===cap,cap<=limits.maxBytes,cap<=(kind==='pdf'?limits.maxPdfBytes:3*1024*1024)];
 if(!checks.every(Boolean)) throw Error('operation reservation receipt mismatch');
 return receipt;
}
