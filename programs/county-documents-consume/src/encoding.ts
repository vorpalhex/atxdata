import {brotliDecompressSync,gunzipSync} from "node:zlib";
import {sha} from "./engine";

export const rawFetch=(url:string,init:RequestInit)=>Bun.fetch(url,{...init,decompress:false});

function declaredLength(headers:Headers,limit:number):number|null {
 const raw=headers.get("content-length");
 if(raw===null) return null;
 if(!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("invalid Content-Length");
 const size=Number(raw);
 if(size>limit) throw new Error("declared body byte limit");
 return size;
}
function decode(wire:Buffer,encoding:string,limit:number):Buffer {
 if(encoding==="identity") return wire;
 if(encoding==="br") return brotliDecompressSync(wire,{maxOutputLength:limit});
 if(encoding==="gzip") return gunzipSync(wire,{maxOutputLength:limit});
 throw new Error("unsupported Content-Encoding");
}
async function readWire(reader:ReadableStreamDefaultReader<Uint8Array>,limit:number) {
 const chunks:Uint8Array[]=[];
 let bytes=0;
 for(;;) {
  const next=await reader.read();
  if(next.done) return Buffer.concat(chunks);
  bytes+=next.value.length;
  if(bytes>limit) throw new Error("body byte limit");
  chunks.push(next.value);
 }
}
/** Own the native reader synchronously; no nested reader or async-FS ownership race. */
export async function consumeEncoded(response:Response,limit:number) {
 const reader=response.body?.getReader();
 if(!reader) throw new Error("empty response body");
 try {
  const declared=declaredLength(response.headers,limit);
  const wire=await readWire(reader,limit);
  if(declared!==null && declared!==wire.length) throw new Error("Content-Length mismatch");
  const encoding=(response.headers.get("content-encoding")??"identity").trim().toLowerCase();
  const body=decode(wire,encoding,limit);
  if(body.length>limit) throw new Error("decoded body byte limit");
  return {wire,body,encoding,encodedHash:sha(wire),decodedHash:sha(body)};
 } finally {
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}
