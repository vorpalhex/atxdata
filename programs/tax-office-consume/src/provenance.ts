export type Producer={started_at:string;finished_at:string|null;status:string;error:string|null};
export function timestamp(value:unknown):number{
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('provenance timestamp');return Date.parse(value);
}
function successfulProducer(run:Producer){if(run.error!==null||run.finished_at===null)throw new Error('producer terminal status');}
function failedProducer(run:Producer){if(typeof run.error!=='string'||!run.error)throw new Error('producer terminal error');}
function runningProducer(run:Producer){if(run.finished_at!==null||run.error!==null)throw new Error('producer status');}
function verifyProducerStatus(run:Producer){
 switch(run.status){
 case 'succeeded': successfulProducer(run);return;
 case 'failed': if(run.finished_at===null)throw new Error('producer terminal error');
 // Interrupted writers may have no known finish; failed runs retain their terminal error.
 case 'interrupted': failedProducer(run);return;
 case 'running': runningProducer(run);return;
 default: throw new Error('producer status');
 }
}
export function producerBounds(run:Producer,now:number){
 const start=timestamp(run.started_at),end=run.finished_at===null?now:timestamp(run.finished_at);
 if(start>end||end>now)throw new Error('producer chronology');
 verifyProducerStatus(run);
 return {start,end};
}
export function observedWithin(value:unknown,bounds:{start:number;end:number}){
 const time=timestamp(value);if(time<bounds.start||time>bounds.end)throw new Error('observation chronology');return time;
}
export function attemptTimes(attempt:{started_at:string;finished_at:string|null;status:string;error:string|null},run:Producer,now:number){
 if(attempt.status!=='validated'||attempt.error!==null)throw new Error('attempt terminal provenance');
 const bounds=producerBounds(run,now),start=observedWithin(attempt.started_at,bounds),end=observedWithin(attempt.finished_at,bounds);
 if(start>end)throw new Error('attempt chronology');return end;
}
export function artifactTimes(file:{imported_at:string|null;retrieved_at:string|null;http_status:number|null;headers:string|null;error:string|null},run:Producer,now:number,live:boolean){
 if(file.error!==null)throw new Error('artifact terminal provenance');
 const bounds=producerBounds(run,now);observedWithin(file.imported_at,bounds);
 if(live)return observedWithin(file.retrieved_at,bounds);
 if(file.retrieved_at!==null||file.http_status!==null||file.headers!==null)throw new Error('retained artifact HTTP provenance');return null;
}
