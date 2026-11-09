import {test,expect} from 'bun:test';import {run} from '../src/cli';import {mkdtemp} from 'node:fs/promises';import {join} from 'node:path';
test('shipped CLI exposes general source/member selections and retained discovery catalog',async()=>{
 const b=await mkdtemp(join(process.env.TMPDIR!,'cli-general-'));const z=join(b,'2023-supp2.zip');
 Bun.spawnSync(['python3','-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('OTHER.TXT','one\\r\\ntwo\\r\\n');z.close()",z]);
 expect(await run(['import-member','--archive',z,'--snapshot','2023-supp2','--member','OTHER.TXT','--start','2','--count','1','--max-expanded','4096','--max-seconds','10','--output',join(b,'out')])).toMatchObject({rows:1,start:2,next:3});
 expect(await run(['verify-members','--output',join(b,'out')])).toMatchObject({rows:1});
});
