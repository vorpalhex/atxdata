import {Database} from 'bun:sqlite';
import {preflightLive} from './live';
import {createHash} from 'node:crypto';import {crc32} from 'node:zlib';
import {withZip,inventory,digest,serialized,selectedStream,consumeChunks,LIMITS} from './archive';
import {loadSchemas,decodeRow} from './layouts';
export type MemberOptions={archive:string;member:string;snapshot:string;start:number;count:number|'all';maxExpanded:number;maxSeconds:number;layout?:string};
export const MEMBER_SCHEMA=`CREATE TABLE IF NOT EXISTS member_versions(id TEXT PRIMARY KEY, identity TEXT NOT NULL, archive TEXT NOT NULL, archive_hash TEXT NOT NULL, layout_hash TEXT, schema_json TEXT, status TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, raw_hash TEXT, complete INTEGER NOT NULL DEFAULT 0, inventory TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS member_rows(version TEXT NOT NULL REFERENCES member_versions(id),ordinal INTEGER NOT NULL,raw BLOB NOT NULL,hash TEXT NOT NULL,values_json TEXT,reason TEXT,PRIMARY KEY(version,ordinal));`;
export function initializeMembers(db:Database){
 db.exec(MEMBER_SCHEMA);
 db.exec(`CREATE TABLE IF NOT EXISTS member_selections(version TEXT PRIMARY KEY REFERENCES member_versions(id),identity TEXT NOT NULL,limits TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS member_selection_update BEFORE UPDATE ON member_selections BEGIN SELECT RAISE(ABORT,'immutable member selection'); END;
 CREATE TRIGGER IF NOT EXISTS member_selection_delete BEFORE DELETE ON member_selections BEGIN SELECT RAISE(ABORT,'immutable member selection'); END;`);
 const columns=db.query<any,[]>('PRAGMA table_info(member_versions)').all();
 if(!columns.some(c=>c.name==='crc_verified')){db.exec('ALTER TABLE member_versions ADD COLUMN crc_verified INTEGER NOT NULL DEFAULT 0');db.exec('UPDATE member_versions SET crc_verified=complete');}
}
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
function selectionNames(o:MemberOptions){
 if(typeof o.member!=='string'||!o.member||typeof o.snapshot!=='string'||!o.snapshot||o.snapshot.length>200)throw new Error('member and snapshot required');
}
function bounds(o:MemberOptions){
 for(const n of [o.start,o.maxExpanded,o.maxSeconds])if(!Number.isSafeInteger(n)||n<1)throw new Error('positive safe selection budgets required');
 if(o.count!=='all'&&(!Number.isSafeInteger(o.count)||o.count<1||!Number.isSafeInteger(o.start+o.count)))throw new Error('positive safe count required');
 selectionNames(o);
}
class RecordSelection{
 carry=Buffer.alloc(0);bytes=0;crc=0;ordinal=0;rows=0;stopped=false;
 constructor(private o:MemberOptions,private onRow:(raw:Buffer,ordinal:number)=>void){}
 emit(raw:Buffer){this.ordinal++;if(this.ordinal>=this.o.start){this.onRow(raw,this.ordinal);this.rows++;}return this.o.count==='all'||this.rows<this.o.count;}
 recordBound(raw:Buffer){if(raw.length>1048576)throw new Error('record byte ceiling');}
 push(b:Buffer){
 this.bytes+=b.length;if(this.bytes>this.o.maxExpanded)throw new Error('expanded byte budget');this.crc=crc32(b,this.crc);this.carry=Buffer.concat([this.carry,b]);
 let end:number;while((end=this.carry.indexOf(10))>=0){const raw=this.carry.subarray(0,end+1);this.carry=this.carry.subarray(end+1);this.recordBound(raw);if(!this.emit(raw)){this.stopped=true;return false;}}
 this.recordBound(this.carry);return true;
 }
 finish(size:number,crc:number){
 if(!this.stopped){if(this.carry.length)this.emit(this.carry);if(this.bytes!==size||this.crc!==crc)throw new Error('member CRC/length mismatch');}
 if(this.o.count!=='all'&&this.rows!==this.o.count)throw new Error('short selected range');
 if(!this.rows)throw new Error('empty selected range');
 return this.result();
 }
 result(){return {rows:this.rows,start:this.o.start,next:this.o.start+this.rows,complete:!this.stopped&&this.o.start===1&&this.o.count==='all',crcVerified:!this.stopped};}
}
export async function streamRecords(o:MemberOptions,onRow:(raw:Buffer,ordinal:number)=>void){
 bounds(o);return withZip(o.archive,LIMITS.compressed,async zip=>{
 const members=await inventory(zip),m=members.find(m=>m.name===o.member);if(!m)throw new Error('selected member missing');
 const selection=new RecordSelection(o,onRow);await consumeChunks(await selectedStream(zip,m),b=>selection.push(b),o.maxSeconds*1000);
 return {...selection.finish(m.size,m.crc),inventory:serialized(members)};
 });
}
function reusedMember(prior:any,o:MemberOptions){return {version:prior.id,rows:prior.row_count,start:o.start,next:o.start+prior.row_count,complete:!!prior.complete,crcVerified:!!prior.crc_verified,reused:true,interpreted:!!prior.schema_json&&prior.schema_json!=='null'&&!JSON.parse(prior.schema_json).error,rejected:prior.rejected};}
type BatchRow={raw:Buffer;ordinal:number};
function persistBatch(db:Database,id:string,batch:BatchRow[],schema:Awaited<ReturnType<typeof versionSchema>>){
 preflightLive(db);let rejected=0;db.transaction(()=>{for(const r of batch){const decoded=decodeRow(r.raw,schema);if(decoded.reason)rejected++;db.query('INSERT INTO member_rows VALUES(?,?,?,?,?,?)').run(id,r.ordinal,r.raw,hash(r.raw),JSON.stringify(decoded.values),decoded.reason);}}).immediate();return rejected;
}
export async function importMember(db:Database,o:MemberOptions){
 preflightLive(db);bounds(o);const archiveHash=await digest(o.archive,LIMITS.compressed),layoutHash=o.layout?await digest(o.layout,LIMITS.layout):null;
 const identity=JSON.stringify({archiveHash,layoutHash,layout:o.layout??null,member:o.member,snapshot:o.snapshot,start:o.start,count:o.count});
 const prior=db.query<any,[string]>("SELECT * FROM member_versions WHERE identity=? AND status='complete'").get(identity);
 if(prior){await verifyMembers(db);return reusedMember(prior,o);}
 const schema=o.layout?(await loadSchemas(o.layout)).find(s=>s.member===o.member):undefined;
 preflightLive(db);const id=crypto.randomUUID();db.query("INSERT INTO member_versions(id,identity,archive,archive_hash,layout_hash,status) VALUES(?,?,?,?,?,'importing')").run(id,identity,o.archive,archiveHash,layoutHash);
 db.query('UPDATE member_versions SET schema_json=? WHERE id=?').run(JSON.stringify(schema??null),id);
 db.query('INSERT INTO member_selections VALUES(?,?,?)').run(id,identity,JSON.stringify({maxExpanded:o.maxExpanded,maxSeconds:o.maxSeconds}));
 let rejected=0;const rawHash=createHash('sha256');let batch:BatchRow[]=[];
 const flush=()=>{rejected+=persistBatch(db,id,batch,schema);batch=[];};
 try{
 const result=await streamRecords(o,(raw,ordinal)=>{rawHash.update(raw);batch.push({raw:Buffer.from(raw),ordinal});if(batch.length===500)flush();});flush();
 preflightLive(db);db.query("UPDATE member_versions SET status='complete',row_count=?,raw_hash=?,complete=?,crc_verified=?,inventory=?,rejected=? WHERE id=?").run(result.rows,rawHash.digest('hex'),Number(result.complete),Number(result.crcVerified),JSON.stringify(result.inventory),rejected,id);
 return {...result,inventory:undefined,version:id,reused:false,interpreted:!!schema&&!schema.error,rejected};
 }catch(e){preflightLive(db);db.query("UPDATE member_versions SET status='failed',error=? WHERE id=?").run(String(e),id);throw e;}
}
function* persistedRows(db:Database,id:string){let last=0;for(;;){const batch=db.query<any,[string,number]>('SELECT * FROM member_rows WHERE version=? AND ordinal>? ORDER BY ordinal LIMIT 500').all(id,last);if(!batch.length)return;for(const r of batch){last=r.ordinal;yield r;}}}
function selectionBinding(db:Database,v:any){
 const binding=db.query<any,[string]>('SELECT * FROM member_selections WHERE version=?').get(v.id);
 if(!binding||binding.identity!==v.identity)throw new Error('independent member selection missing/mismatch; operator review');
 const identity=JSON.parse(v.identity);bounds({...identity,maxExpanded:LIMITS.total,maxSeconds:3600});
 if(identity.count!=='all'&&identity.count!==v.row_count)throw new Error('selected count coverage');
 if(identity.archiveHash!==v.archive_hash||identity.layoutHash!==v.layout_hash)throw new Error('member identity');
 return identity;
}
async function versionSchema(v:any,identity:any){
 const schema=identity.layout?(await loadSchemas(identity.layout)).find(s=>s.member===identity.member):undefined;
 if(identity.layout&&await digest(identity.layout,LIMITS.layout)!==v.layout_hash)throw new Error('layout provenance');
 if(JSON.stringify(schema??null)!==v.schema_json)throw new Error('schema provenance');
 return schema;
}
async function versionMember(v:any,identity:any){
 if(await digest(v.archive,LIMITS.compressed)!==v.archive_hash)throw new Error('member archive provenance');
 const members=await withZip(v.archive,LIMITS.compressed,async z=>serialized(await inventory(z)));
 if(JSON.stringify(members)!==v.inventory)throw new Error('inventory provenance');
 const member=members.find(m=>m.name===identity.member);if(!member)throw new Error('member provenance');
 return member;
}
async function compareOriginal(db:Database,v:any,identity:any){
 const stored=persistedRows(db,v.id);
 const result=await streamRecords({archive:v.archive,member:identity.member,snapshot:identity.snapshot,start:identity.start,count:identity.count,maxExpanded:LIMITS.total,maxSeconds:3600},(raw,ordinal)=>{
 const r=stored.next();if(r.done)throw new Error('retained original row provenance missing');
 if(r.value.ordinal!==ordinal)throw new Error('retained original row provenance ordinal');
 if(!raw.equals(Buffer.from(r.value.raw)))throw new Error('retained original row provenance bytes');
 });
 if(!stored.next().done)throw new Error('retained original coverage');
 if(Number(result.crcVerified)!==v.crc_verified)throw new Error('member CRC assertion provenance');
}
function storedCoverage(db:Database,v:any,identity:any,schema:Awaited<ReturnType<typeof versionSchema>>){
 if(db.query<any,[string]>('SELECT count(*) n FROM member_rows WHERE version=?').get(v.id).n!==v.row_count)throw new Error('member coverage row count');
 const rawHash=createHash('sha256');let count=0,bytes=0,crc=0,rejected=0;
 for(const r of persistedRows(db,v.id)){
 const raw=Buffer.from(r.raw);if(r.ordinal!==identity.start+count||hash(raw)!==r.hash)throw new Error('member row provenance');
 const decoded=decodeRow(raw,schema);if(JSON.stringify(decoded.values)!==r.values_json||decoded.reason!==r.reason)throw new Error('member row interpretation');
 if(decoded.reason)rejected++;rawHash.update(raw);crc=crc32(raw,crc);bytes+=raw.length;count++;
 }
 return {count,bytes,crc,rejected,hash:rawHash.digest('hex')};
}
function checkCoverage(v:any,identity:any,member:Awaited<ReturnType<typeof versionMember>>,c:ReturnType<typeof storedCoverage>){
 if(v.complete&&(identity.start!==1||identity.count!=='all'||c.bytes!==member.size||c.crc!==member.crc))throw new Error('complete member coverage');
 if(c.rejected!==v.rejected||c.count!==v.row_count||c.hash!==v.raw_hash)throw new Error('member coverage provenance');
}
function coverageFacts(v:any){
 if(![0,1].includes(v.complete)||![0,1].includes(v.crc_verified))throw new Error('invalid complete/CRC boolean fact');
 if(v.complete===1&&v.crc_verified!==1)throw new Error('complete member requires verified CRC fact');
}
export async function verifyMembers(db:Database){
 preflightLive(db);let rows=0,versions=0;
 for(const v of db.query<any,[]>("SELECT * FROM member_versions WHERE status='complete'").all()){
 coverageFacts(v);const identity=selectionBinding(db,v),schema=await versionSchema(v,identity),member=await versionMember(v,identity);
 if(!v.complete)await compareOriginal(db,v,identity);
 preflightLive(db);const coverage=storedCoverage(db,v,identity,schema);checkCoverage(v,identity,member,coverage);
 rows+=coverage.count;versions++;
 }return {versions,rows,httpRequests:0};
}
