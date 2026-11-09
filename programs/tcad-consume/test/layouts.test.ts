import {test,expect} from 'bun:test';import {loadSchemas} from '../src/layouts';import {readFile} from 'node:fs/promises';
const retained=process.env.TCAD_INPUTS?JSON.parse(await readFile(process.env.TCAD_INPUTS,'utf8')):null;
(retained?test:test.skip)('actual workbook covers multiple record classes, not just Property PDF',async()=>{
 const schemas=await loadSchemas(retained.layout);expect(schemas).toHaveLength(20);
 expect(schemas.find(s=>s.member==='PROP.TXT')?.fields).toHaveLength(493);
 expect(schemas.find(s=>s.member==='ABS_SUBD.TXT')?.width).toBe(50);
 expect(schemas.find(s=>s.member==='SKETCH.TXT')?.format).toBe('tab');
 const p=Bun.spawnSync([process.execPath,'src/cli.ts','layouts','--layout',retained.layout],{cwd:import.meta.dir+'/..',maxBuffer:4*1024**2});expect(p.exitCode).toBe(0);expect(JSON.parse(p.stdout.toString())).toHaveLength(20);
 const pipe=Bun.spawnSync(['python3','-c',"import subprocess,json,sys; p=subprocess.run([sys.argv[1],'src/cli.ts','layouts','--layout',sys.argv[2]],capture_output=True,check=True); assert len(json.loads(p.stdout))==20",process.execPath,retained.layout],{cwd:import.meta.dir+'/..'});expect(pipe.exitCode).toBe(0);
});
