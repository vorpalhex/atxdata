import {test,expect} from 'bun:test';import {join} from 'node:path';
for(const kind of ['leap','contiguous','opaque'] as const)test('native uninterrupted Civic raw history '+kind,async()=>{
 const calls:string[]=[];const event=(id:number)=>({id,eventName:'Fixture',eventDate:'2030-03-04T00:00:00Z',publishedFiles:[]});
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const url=new URL(req.url);calls.push(url.search);const tail=url.searchParams.has('$skip')||url.searchParams.has('$skiptoken');return Response.json({value:[event(tail?(kind==='leap'?3:2):1)],...(!tail?{'@odata.nextLink':kind==='opaque'?'?$skiptoken=9000':`?$skip=${kind==='leap'?2:1}`}:{})});}});
 try{const child=Bun.spawn([process.execPath,'src/cli.ts','list-meetings','--from','2030-03-04','--to','2030-03-04','--max-pages','4'],{cwd:join(import.meta.dir,'..'),env:{...process.env,CIVICCLERK_API_BASE:server.url+'v1/',HTTP_MIN_INTERVAL_MS:'0',HTTP_MAX_RETRIES:'0'},stdout:'pipe',stderr:'pipe'});const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  if(kind==='leap'){expect(exit).toBe(1);expect(stderr).toContain('offset/history mismatch');expect(stdout).toBe('');expect(calls).toHaveLength(1);}
  else{expect({exit,stderr}).toEqual({exit:0,stderr:''});expect(JSON.parse(stdout).map((e:{id:number})=>e.id)).toEqual([1,2]);expect(calls).toHaveLength(2);if(kind==='opaque')expect(new URLSearchParams(calls[1]).get('$skiptoken')).toBe('9000');}
 }finally{server.stop(true);}
});
