import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,access,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('native Civic rejects non-object and invalid continuation checkpoints before output or HTTP',async()=>{
 const root=await mkdtemp(join(tmpdir(),'civic-resume-'));let calls=0;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){calls++;return Response.json({value:[]});}});
 try{for(const [i,value] of [null,false,0,'',[],{}, {complete:false,continuation:{}},{complete:false,continuation:[]}].entries()){
  const prior=join(root,`${i}.json`),out=join(root,`${i}-out.json`);await writeFile(prior,JSON.stringify(value));
  const child=Bun.spawn([process.execPath,'src/cli.ts','list-meetings','--from','2030-03-04','--to','2030-03-04','--max-pages','1','--resume',prior,'--checkpoint',out],{env:{...process.env,...(i===6?{HTTP_MAX_RETRIES:'bad'}:{}),CIVICCLERK_API_BASE:`http://127.0.0.1:${server.port}/v1/`},stdout:'pipe',stderr:'pipe'});
  await new Response(child.stdout).text();const stderr=await new Response(child.stderr).text();if(i===6)expect(stderr).toContain('continuation');expect(await child.exited).not.toBe(0);expect(calls).toBe(0);expect(await access(out).then(()=>true,()=>false)).toBe(false);
 }}finally{server.stop(true);await rm(root,{recursive:true,force:true});}
});
