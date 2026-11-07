import {expect,test} from "bun:test";
import {brotliCompressSync,gzipSync} from "node:zlib";
import {consumeEncoded,rawFetch} from "../src/encoding";
import {sha} from "../src/engine";

for(const [encoding,compress] of [["br",brotliCompressSync],["gzip",gzipSync]] as const) {
 test(`${encoding} retains distinct encoded/decoded provenance and checks wire length`,async()=>{
  const body=Buffer.from("User-agent: *\nDisallow: /private\n".repeat(100));
  const wire=compress(body);
  const response=new Response(wire,{headers:{"Content-Encoding":encoding,"Content-Length":String(wire.length)}});
  const result=await consumeEncoded(response,10000);
  expect(result.body).toEqual(body);
  expect(result.wire).toEqual(wire);
  expect(result.encodedHash).toBe(sha(wire));
  expect(result.decodedHash).toBe(sha(body));
  await expect(consumeEncoded(new Response(wire,{headers:{"Content-Encoding":encoding,"Content-Length":String(body.length)}}),10000)).rejects.toThrow("Content-Length mismatch");
  await expect(consumeEncoded(new Response(wire,{headers:{"Content-Encoding":encoding}}),100)).rejects.toThrow();
 });
}
test("native Bun raw fetch does not silently decompress localhost fixture",async()=>{
 const body=Buffer.from("retained robots body ".repeat(100));const wire=brotliCompressSync(body);
 const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response(wire,{headers:{"Content-Encoding":"br","Content-Length":String(wire.length)}})});
 try {
  const result=await consumeEncoded(await rawFetch(`http://127.0.0.1:${server.port}/fixture`,{}),10000);
  expect(result.wire).toEqual(wire);expect(result.body).toEqual(body);
 }finally{await server.stop(true);}
});
test("identity boundaries, unsupported encoding and malformed lengths fail closed",async()=>{
 expect((await consumeEncoded(new Response("okay",{headers:{"Content-Length":"4"}}),4)).body.toString()).toBe("okay");
 await expect(consumeEncoded(new Response("large"),4)).rejects.toThrow("byte limit");
 await expect(consumeEncoded(new Response("okay",{headers:{"Content-Length":"4x"}}),10)).rejects.toThrow();
 await expect(consumeEncoded(new Response("okay",{headers:{"Content-Encoding":"unknown"}}),10)).rejects.toThrow();
 await expect(consumeEncoded(new Response("okay",{headers:{"Content-Encoding":""}}),10)).rejects.toThrow("unsupported Content-Encoding");
 await expect(consumeEncoded(new Response(null),10)).rejects.toThrow("empty response body");
 await expect(consumeEncoded(new Response("okay",{headers:{"Content-Length":"9007199254740992"}}),10)).rejects.toThrow("invalid Content-Length");
});
