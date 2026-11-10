import * as yauzl from 'yauzl';import {open,stat} from 'node:fs/promises';import {constants} from 'node:fs';import {createHash} from 'node:crypto';import {crc32} from 'node:zlib';import {statFile} from '../../civicclerk-consume/src/archive';import {dirname,resolve,isAbsolute} from 'node:path';
export type Member={name:string;size:number;compressed:number;crc:number;method:number;flags:number;attributes:number;ordinal:number;entry?:yauzl.Entry};
export const LIMITS={compressed:671088640,layout:1048576,total:20*1024**3,member:10*1024**3,members:64,sample:25*9924,seconds:900};
function safePath(name:string){
 const parts=name.split('/');if(!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||parts.some(p=>!p||p==='.'||p==='..')||/[\x00-\x1f]/.test(name))throw new Error('unsafe ZIP member path');
}
function memberMetadata(m:Member){
 const mode=(m.attributes>>>16)&0xf000;if(mode!==0&&mode!==0x8000)throw new Error('unsafe ZIP member type');
 if((m.flags&0x41)||![0,8].includes(m.method)||!Number.isSafeInteger(m.size)||m.size<0||m.size>LIMITS.member)throw new Error('ZIP member flags/method/expansion cap');
}
export function safeMember(m:Member){safePath(m.name);memberMetadata(m);}

export function checkInventory(members:Member[]){
 if(members.length<1||members.length>LIMITS.members)throw new Error('member count ceiling');
 const names=new Set<string>();let total=0;
 for(const m of members){safeMember(m);if(names.has(m.name))throw new Error('duplicate ZIP member');names.add(m.name);total+=m.size;}
 if(total>LIMITS.total)throw new Error('ZIP total expansion cap');return members;
}
async function safeInput(path:string,cap:number){
 if(!isAbsolute(path)||resolve(path)!==path)throw new Error('canonical absolute input required');
 for(let p=path;p!==dirname(p);p=dirname(p))await statFile(p);
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await handle.stat();if(!s.isFile()||s.size<1||s.size>cap)throw new Error('compressed input ceiling');return handle;}catch(e){await handle.close();throw e;}
}
export async function digest(path:string,cap:number){
 const h=await safeInput(path,cap),hash=createHash('sha256'),buffer=Buffer.alloc(1048576),start=Date.now();let count=0;
 try{for(;;){if(Date.now()-start>120000)throw new Error('hash time ceiling');const {bytesRead}=await h.read(buffer,0,buffer.length,null);if(!bytesRead)break;count+=bytesRead;if(count>cap)throw new Error('hash byte ceiling');hash.update(buffer.subarray(0,bytesRead));}if(count!==(await h.stat()).size)throw new Error('input changed');return hash.digest('hex');}finally{await h.close();}
}
export async function withZip<T>(path:string,cap:number,work:(zip:yauzl.ZipFile)=>Promise<T>):Promise<T>{
 const h=await safeInput(path,cap);let zip:yauzl.ZipFile|undefined;
 try{zip=await new Promise<yauzl.ZipFile>((yes,no)=>yauzl.fromFd(h.fd,{autoClose:false,lazyEntries:true,decodeStrings:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?no(e):yes(z)));return await work(zip);}
 finally{zip?.removeAllListeners();await h.close();}
}
export async function inventory(zip:yauzl.ZipFile):Promise<Member[]>{
 return new Promise((yes,no)=>{
  const rows:Member[]=[];const timer=setTimeout(()=>finish(new Error('inventory time ceiling')),10000);
  const finish=(error?:Error)=>{clearTimeout(timer);zip.removeListener('entry',entry);zip.removeListener('end',end);zip.removeListener('error',fail);if(error)no(error);else{try{yes(checkInventory(rows));}catch(e){no(e);}}};
  const fail=(e:Error)=>finish(e),end=()=>finish();
  const entry=(e:yauzl.Entry)=>{try{if(rows.length>=LIMITS.members)throw new Error('member count ceiling');const m={name:e.fileName,size:e.uncompressedSize,compressed:e.compressedSize,crc:e.crc32,method:e.compressionMethod,flags:e.generalPurposeBitFlag,attributes:e.externalFileAttributes,ordinal:rows.length+1,entry:e};safeMember(m);rows.push(m);zip.readEntry();}catch(e){finish(e instanceof Error?e:new Error(String(e)));}};
  zip.on('entry',entry);zip.once('end',end);zip.once('error',fail);zip.readEntry();
 });
}
export async function selectedStream(zip:yauzl.ZipFile,m:Member){
 if(!m.entry)throw new Error('member handle required');return new Promise<import('node:stream').Readable>((yes,no)=>zip.openReadStream(m.entry!,(e,s)=>e?no(e):yes(s)));
}
export function consumeChunks(stream:import('node:stream').Readable,onChunk:(b:Buffer)=>boolean,timeout:number){
 // fd-slicer's stored-member stream marks itself destroyed at EOF before
 // Bun's async iterator drains its buffer. Data/end events own this stream.
 return new Promise<void>((yes,no)=>{
  let done=false;const timer=setTimeout(()=>finish(new Error('member time ceiling')),Math.max(1,timeout));
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);stream.removeListener('data',data);stream.removeListener('end',end);stream.removeListener('error',fail);stream.removeListener('close',close);stream.once('error',()=>{});stream.destroy();if(error)no(error);else yes();};
  const fail=(e:Error)=>finish(e),end=()=>finish(),close=()=>finish(new Error('member stream interrupted'));
  const data=(value:Buffer)=>{try{if(!onChunk(Buffer.from(value))){stream.pause();queueMicrotask(()=>finish());}}catch(e){finish(e instanceof Error?e:new Error(String(e)));}};
  stream.once('error',fail);stream.once('end',end);stream.once('close',close);stream.on('data',data);
 });
}
async function buffered(readable:import('node:stream').Readable,cap:number,prefix:boolean){
 const chunks:Buffer[]=[];let count=0,crc=0;
 await consumeChunks(readable,b=>{crc=crc32(b,crc);const take=Math.min(b.length,cap-count);chunks.push(b.subarray(0,take));count+=take;if(prefix&&count===cap)return false;if(count>cap||b.length>take)throw new Error('member stream byte ceiling');return true;},900000);
 return {raw:Buffer.concat(chunks,count),count,crc};
}

function checkRead(m:Member,prefix:boolean,cap:number,count:number,crc:number){
 if(prefix){if(count!==cap)throw new Error('short selected prefix');}else if(count!==m.size||crc!==m.crc)throw new Error('member CRC/length mismatch');
}
export async function readMember(zip:yauzl.ZipFile,m:Member,cap:number,prefix=false):Promise<Buffer>{
 safeMember(m);if(!Number.isSafeInteger(cap)||cap<1||cap>LIMITS.layout)throw new Error('buffered member cap');if(!prefix&&m.size>cap)throw new Error('selected member byte ceiling');
 const readable=await selectedStream(zip,m);const {raw,count,crc}=await buffered(readable,cap,prefix);checkRead(m,prefix,cap,count,crc);return raw;
}
async function verifyMember(zip:yauzl.ZipFile,m:Member,deadline:number,onBytes:(n:number)=>void){
 const stream=await selectedStream(zip,m);let bytes=0,crc=0;
 await consumeChunks(stream,b=>{if(Date.now()>deadline)throw new Error('integrity time ceiling');bytes+=b.length;onBytes(b.length);if(bytes>m.size)throw new Error('member stream ceiling');crc=crc32(b,crc);return true;},deadline-Date.now());
 if(bytes!==m.size||crc!==m.crc)throw new Error('member CRC/length mismatch');return bytes;
}

function integrityBounds(members:Member[],maxExpanded:number,maxSeconds:number){
 if(!Number.isSafeInteger(maxExpanded)||maxExpanded<1||maxExpanded>LIMITS.total)throw new Error('explicit total ceiling');if(!Number.isSafeInteger(maxSeconds)||maxSeconds<1||maxSeconds>900)throw new Error('explicit time ceiling');
 if(members.reduce((n,m)=>n+m.size,0)>maxExpanded)throw new Error('total expansion ceiling');
}
export async function integrity(zip:yauzl.ZipFile,members:Member[],maxExpanded:number,maxSeconds:number){
 checkInventory(members);integrityBounds(members,maxExpanded,maxSeconds);
 const deadline=Date.now()+maxSeconds*1000;let total=0;
 for(const m of members)await verifyMember(zip,m,deadline,n=>{total+=n;if(total>maxExpanded)throw new Error('total stream expansion ceiling');});
 return {members:members.length,expandedBytes:total};
}
export function serialized(members:Member[]){return members.map(({entry,...member})=>member);}
