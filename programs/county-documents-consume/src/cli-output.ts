// Keep result formatting separate from delivery. FileSink observes native write
// errors and drains nonblocking pipes; console.log can silently lose EBADF.
export async function writeStdout(text:string):Promise<void> {
 const sink=Bun.stdout.writer({highWaterMark:65536});
 let timer:ReturnType<typeof setTimeout>|undefined;
 const delivery=(async()=>{
  const bytes=Buffer.from(text);
  for(let offset=0;offset<bytes.length;offset+=65536) {
   await sink.write(bytes.subarray(offset,offset+65536));
   await sink.flush();
  }
 })();
 try {
  await Promise.race([delivery,new Promise<never>((_,reject)=>{
   timer=setTimeout(()=>reject(Object.assign(Error(),{code:'ETIMEDOUT'})),5000);
  })]);
 } catch(error) {
  const code=(error as NodeJS.ErrnoException).code;
  if(code==='EPIPE') return; // Preserve legacy quiet downstream-close status 0.
  const safeCode=code && /^[A-Z0-9_]+$/.test(code)?code:'EIO';
  throw Error(`stdout delivery failed (${safeCode}); completed archive facts are retained`);
 } finally {
  clearTimeout(timer);
  // A blocked downstream must not keep the CLI alive after its deadline.
  sink.unref();
 }
}
