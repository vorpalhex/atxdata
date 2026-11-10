import {test,expect} from 'bun:test';
import {Store} from '../src/store';
import {mkdtemp} from 'node:fs/promises';import {join} from 'node:path';
const base=await mkdtemp(join(process.env.TMPDIR!,'general-'));
const zip=join(base,'other.zip');
const made=Bun.spawnSync(['python3','-c',`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('STATE_CD.TXT',b''.join(('%03d\\r\\n'%i).encode() for i in range(1,1801)))
`,zip]);if(made.exitCode)throw new Error('fixture creation');
test('arbitrary snapshot imports nonprefix ranges and full members with retained ordinal/raw and deterministic reuse',async()=>{
 const s=await Store.open(join(base,'archive'));
 try{
 const opts={archive:zip,member:'STATE_CD.TXT',snapshot:'2024-supp7',start:31,count:30,maxExpanded:10000,maxSeconds:10};
 const a=await s.importMember(opts);expect(a).toMatchObject({rows:30,start:31,next:61,complete:false});
 expect(await s.importMember(opts)).toMatchObject({reused:true});
 const b=await s.importMember({...opts,start:1,count:'all' as const});expect(b).toMatchObject({rows:1800,complete:true,crcVerified:true});
 expect(await s.verifyMembers()).toMatchObject({versions:2,rows:1830});
 const row=s.db.query('SELECT ordinal,raw FROM member_rows WHERE version=? ORDER BY ordinal LIMIT 1').get(a.version) as any;
 expect(row.ordinal).toBe(31);expect(Buffer.from(row.raw).toString()).toBe('031\r\n');
 }finally{await s.close();}
});
