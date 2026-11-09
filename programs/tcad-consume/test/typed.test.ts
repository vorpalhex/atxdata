import {test,expect} from 'bun:test';import {Store} from '../src/store';import {mkdtemp,readFile} from 'node:fs/promises';import {join} from 'node:path';
const x=process.env.TCAD_INPUTS?JSON.parse(await readFile(process.env.TCAD_INPUTS,'utf8')):null;
(x?test:test.skip)('real nonprefix Property and complete small class use per-input workbook schemas',async()=>{
 const s=await Store.open(join(await mkdtemp(join(process.env.TMPDIR!,'typed-')),'out'));
 try{
 const o={archive:x.archive,layout:x.layout,snapshot:'2026-certified-supp0',member:'PROP.TXT',start:101,count:30,maxExpanded:2097152,maxSeconds:30};
 const r=await s.importMember(o);expect(r).toMatchObject({rows:30,interpreted:true,rejected:0,complete:false,next:131});
 const raw=Buffer.from((s.db.query<any,[string]>('SELECT raw FROM member_rows WHERE version=? ORDER BY ordinal LIMIT 1').get(r.version)).raw);raw.write('02024',17,'ascii');raw.write('000000000007',22,'ascii');
 const fixture=join(s.root,'other-year.zip');const made=Bun.spawnSync(['python3','-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED);z.writestr('PROP.TXT',sys.stdin.buffer.read());z.close()",fixture],{stdin:raw});expect(made.exitCode).toBe(0);
 expect(await s.importMember({...o,archive:fixture,snapshot:'2024-supp7-fixture',start:1,count:'all' as const})).toMatchObject({rows:1,complete:true,interpreted:true,rejected:0});
 expect(await s.importMember({...o,member:'STATE_CD.TXT',start:1,count:'all' as const})).toMatchObject({complete:true,crcVerified:true,interpreted:true,rejected:0});
 }finally{await s.close();}
},30000);
