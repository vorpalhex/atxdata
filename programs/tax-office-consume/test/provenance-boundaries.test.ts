import {test,expect} from 'bun:test';import {producerBounds,observedWithin,artifactTimes,type Producer} from '../src/provenance';
const start='2030-03-04T00:00:00.000Z',finish='2030-03-04T00:00:01.000Z',now=Date.parse(finish)+1000;
const run:Producer={started_at:start,finished_at:finish,status:'succeeded',error:null};
test('producer chronology permits inclusive instantaneous runs and observations, never future finishes',()=>{
 expect(producerBounds({...run,finished_at:start},now)).toEqual({start:Date.parse(start),end:Date.parse(start)});
 const bounds=producerBounds(run,now);expect(observedWithin(start,bounds)).toBe(bounds.start);expect(observedWithin(finish,bounds)).toBe(bounds.end);
 expect(()=>producerBounds({...run,finished_at:'2030-03-05T00:00:00.000Z'},now)).toThrow('chronology');
});
test('successful historical producer still needs a terminal finish, failed producer needs meaningful error',()=>{
 expect(()=>producerBounds({...run,finished_at:null},now)).toThrow('terminal');
 for(const error of ['',null,3])expect(()=>producerBounds({...run,status:'failed',error:error as any},now)).toThrow('terminal');
 expect(producerBounds({...run,status:'failed',error:'layout 503 after valid CSV'},now)).toBeDefined();
});
test('offline artifact NULL rules reject each independent fabricated HTTP field',()=>{
 const file={imported_at:start,retrieved_at:null,http_status:null,headers:null,error:null};expect(artifactTimes(file,run,now,false)).toBe(null);
 for(const delta of [{retrieved_at:start},{http_status:200},{headers:'{}'}])expect(()=>artifactTimes({...file,...delta},run,now,false)).toThrow('retained artifact HTTP provenance');
});
