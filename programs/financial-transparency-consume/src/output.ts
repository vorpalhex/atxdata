import { write } from 'node:fs';
export class OutputFailure extends Error {
 constructor(readonly brokenPipe:boolean,readonly timedOut=false){super('output delivery failed');}
}
function writeChunk(bytes:Uint8Array):Promise<number>{
 return new Promise((resolve,reject)=>write(1,bytes,(error,count)=>error?reject(error):resolve(count)));
}
// Shared native importer/acquisition delivery. No hidden stdout buffer remains;
// deadline includes blocking pipes, not only EAGAIN. Timeout terminates the
// outstanding native worker after diagnostics, never repeats domain operations.
export async function writeOutput(text:string, writer:(bytes:Uint8Array)=>number|Promise<number>=writeChunk) {
 const bytes=Buffer.from(text+'\n');
 let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new OutputFailure(false,true)),5000);});
 try {
  let offset=0;
  while(offset<bytes.length){
   const chunk=bytes.subarray(offset,Math.min(offset+65536,bytes.length));
   try {
    const count=await Promise.race([Promise.resolve().then(()=>writer(chunk)),deadline]);
    if(!Number.isInteger(count)||count<=0||count>chunk.length)throw new OutputFailure(false);
    offset+=count;
   }catch(error){
    if(error instanceof OutputFailure)throw error;
    const code=(error as NodeJS.ErrnoException)?.code;
    if(code==='EAGAIN'||code==='EWOULDBLOCK'||code==='EINTR'){
     await Promise.race([new Promise(resolve=>setTimeout(resolve,10)),deadline]);continue;
    }
    throw new OutputFailure(code==='EPIPE');
   }
  }
 }finally{clearTimeout(timer!);}
}
export function outputStatus(error:OutputFailure, completedExit:number, diagnose:(text:string)=>void=console.error){
 if(error.brokenPipe)return completedExit;
 diagnose('financial-transparency-consume: output delivery failed; check stdout destination. Completed archive work is retained.');return 1;
}
