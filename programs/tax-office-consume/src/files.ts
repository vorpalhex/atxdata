import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {positive} from './source';
type FileHandle=Awaited<ReturnType<typeof open>>;
async function digestChunks(source:FileHandle,maxBytes:number,target?:FileHandle){
 const hash=createHash('sha256'),buffer=Buffer.alloc(64*1024);let bytes=0;
 for(;;){const {bytesRead}=await source.read(buffer,0,buffer.length,null);if(!bytesRead)break;bytes+=bytesRead;if(bytes>maxBytes)throw new Error('file_limit');const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);if(target)await target.writeFile(chunk);}
 return {hash:hash.digest('hex'),bytes};
}
function unchanged(before:{size:number;mtimeMs:number;ctimeMs:number},after:{size:number;mtimeMs:number;ctimeMs:number},bytes:number){
 if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error('input_changed');
}
// One descriptor owns each source; no symlink-following or unbounded allocation.
export async function fileDigest(path:string,maxBytes:number,destination?:string){
 positive(maxBytes,'byte');
 const source=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let target:Awaited<ReturnType<typeof open>>|undefined;
 try{
  const before=await source.stat();if(!before.isFile()||before.size<1||before.size>maxBytes)throw new Error('file_limit');
  if(destination)target=await open(destination,'wx',0o600);
  const {hash,bytes}=await digestChunks(source,maxBytes,target);
  const after=await source.stat();unchanged(before,after,bytes);
  await target?.sync();return {hash,bytes};
 }finally{try{await target?.close();}finally{await source.close();}}
}
