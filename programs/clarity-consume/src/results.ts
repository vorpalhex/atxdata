import { crc32, inflateRawSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { CAPS, token } from './source';

/** Deliberately only the observed single-member ZIP shape. No extraction or descriptors. */
function equalFields(fields:[unknown,unknown][],where:string):void {
  if(!fields.every(([actual,expected])=>actual===expected))throw new Error(where);
}
function directory(b:Buffer):number {
  if(b.length<98)throw new Error('ZIP length');
  const e=b.length-22;
  equalFields([[b.readUInt32LE(0),0x04034b50],[b.readUInt32LE(e),0x06054b50],[b.readUInt32LE(e+4),0],[b.readUInt16LE(e+8),1],[b.readUInt16LE(e+10),1],[b.readUInt16LE(e+20),0]],'ZIP signature/member count/end');
  const c=b.readUInt32LE(e+16);
  if(c+56!==e)throw new Error('ZIP directory bounds');
  equalFields([[b.readUInt32LE(e+12),56],[b.readUInt32LE(c),0x02014b50],[b.readUInt32LE(c+42),0],[b.readUInt16LE(c+28),10],[b.readUInt32LE(c+30),0],[b.readUInt16LE(c+34),0],[b.subarray(c+46,c+56).toString(),'detail.xml']],'ZIP directory/member identity');
  return c;
}
function localHeader(b:Buffer,c:number){
  const flags=b.readUInt16LE(c+8),method=b.readUInt16LE(c+10),size=b.readUInt32LE(c+24),packed=b.readUInt32LE(c+20),crc=b.readUInt32LE(c+16);
  if(flags!==0 || ![0,8].includes(method) || size<1 || size>CAPS.xmlBytes)throw new Error('ZIP flags/size/method');
  equalFields([[b.readUInt16LE(6),flags],[b.readUInt16LE(8),method],[b.readUInt32LE(14),crc],[b.readUInt32LE(18),packed],[b.readUInt32LE(22),size],[b.readUInt16LE(26),10],[b.readUInt16LE(28),0],[b.subarray(30,40).toString(),'detail.xml'],[40+packed,c]],'ZIP local/directory disagreement');
  return {method,size,crc};
}
export function xmlFromZip(b:Buffer):string {
  const c=directory(b),{method,size,crc}=localHeader(b,c),compressed=b.subarray(40,c);
  const xml=method===8?inflateRawSync(compressed,{maxOutputLength:CAPS.xmlBytes}):compressed;
  equalFields([[xml.length,size],[crc32(xml),crc]],'ZIP CRC/length');
  return new TextDecoder('utf-8',{fatal:true}).decode(xml);
}
export function count(value:unknown):number {
  if (typeof value==='string' && /^[0-9]+$/.test(value)) value=Number(value);
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<0) throw new Error('nonnegative integer count required');
  return value;
}
function label(value:unknown):string { if(typeof value!=='string' || !value.length) throw new Error('source string required'); return value; }
function unique<T>(rows:T[], key:(value:T)=>string):T[] {
  const keys=rows.map(key);
  if(new Set(keys).size!==keys.length) throw new Error('duplicate source key');
  return rows;
}
export type ResultRow={contest:string;choice:string;voteType:string;precinct:string;votes:number};
export type Choice={key:string;name:string;total:number;types:{name:string;total:number;precincts:{name:string;votes:number}[]}[]};
export type Contest={key:string;name:string;reporting:number;reported:number;choices:Choice[]};
export type Snapshot={name:string;date:string;region:string;timestamp:string;registered:number;ballots:number;turnout:{name:string;registered:number;ballots:number;reporting:number}[];contests:Contest[];rows:ResultRow[]};
function parseChoice(ch:any):Choice {
  return {key:token(ch.key), name:label(ch.text),total:count(ch.totalVotes),types:unique((ch.VoteType??[]).map((vt:any)=>({name:label(vt.name),total:count(vt.votes),precincts:unique((vt.Precinct??[]).map((p:any)=>({name:label(p.name),votes:count(p.votes)})),(p:any)=>p.name)})),(v:any)=>v.name)};
}
function parseContest(c:any):Contest {
  return {key:token(c.key),name:label(c.text),reporting:count(c.precinctsReporting),reported:count(c.precinctsReported),choices:unique((c.Choice??[]).map(parseChoice),(ch:Choice)=>ch.key)};
}
function xmlRoot(xml:string):any {
  if (Buffer.byteLength(xml)>CAPS.xmlBytes || /<!\s*(DOCTYPE|ENTITY)/i.test(xml) || XMLValidator.validate(xml)!==true) throw new Error('unsafe/invalid XML');
  const x=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,parseAttributeValue:false,isArray:(name)=>['Contest','Choice','VoteType','Precinct'].includes(name)}).parse(xml).ElectionResult;
  if(!x) throw new Error('ElectionResult required');return x;
}
function parseTurnout(x:any):Snapshot['turnout']{
  return unique<Snapshot['turnout'][number]>((x.VoterTurnout?.Precincts?.Precinct??[]).map((p:any)=>({name:label(p.name),registered:count(p.totalVoters),ballots:count(p.ballotsCast),reporting:count(p.percentReporting)})),p=>p.name);
}
export function parseXml(xml:string):Snapshot {
  const x=xmlRoot(xml),contests=unique<Contest>((x.Contest??[]).map(parseContest),c=>c.key),turnout=parseTurnout(x);
  const rows:ResultRow[]=contests.flatMap(c=>c.choices.flatMap(ch=>ch.types.flatMap(v=>v.precincts.map(p=>({contest:c.key,choice:ch.key,voteType:v.name,precinct:p.name,votes:p.votes})))));
  if(!rows.length || rows.length>CAPS.rows || !turnout.length || !contests.length) throw new Error('result row ceiling/empty scope');
  return {name:label(x.ElectionName),date:label(x.ElectionDate),region:label(x.Region),timestamp:label(x.Timestamp),registered:count(x.VoterTurnout.totalVoters),ballots:count(x.VoterTurnout.ballotsCast),turnout,contests,rows};
}
function array(value:unknown):any[] {if(!Array.isArray(value)) throw new Error('parallel array required'); return value;}
function parallel(...arrays:any[][]) {if(!arrays.every(a=>a.length===arrays[0].length)) throw new Error('parallel array length mismatch');}
function sum(values:number[]):number {return count(values.reduce((a,b)=>a+b,0));}
export function reconcile(x:Snapshot, summary:unknown, details:any, status:any) {
  const mismatches:string[]=[];
  const same=(a:unknown,b:unknown,where:string)=>{if(JSON.stringify(a)!==JSON.stringify(b)) mismatches.push(where);};
  const s=unique(array(summary),c=>token(c.K)), d=unique(array(details.Contests),c=>token(c.K));
  same(s.map(c=>c.K),x.contests.map(c=>c.key),'summary contest keys/order');
  same(d.map(c=>c.K),x.contests.map(c=>c.key),'detail contest keys/order');
  for(const c of x.contests) reconcileContest(c,s.find(v=>v.K===c.key),d.find(v=>v.K===c.key),same);
  const ps=array(status.P), r=array(status.R), b=array(status.B), st=array(status.S), cv=array(status.C);
  parallel(ps,r,b,st,cv); unique(ps,label);
  same(ps,x.turnout.map(p=>p.name),'turnout labels/order');
  x.turnout.forEach((p,i)=>{same(p.registered,count(r[i]),`registered ${p.name}`);same(p.ballots,count(b[i]),`ballots ${p.name}`);same(p.reporting,count(st[i]),`reporting ${p.name}`);count(cv[i]);});
  same(sum(x.turnout.map(p=>p.registered)),x.registered,'registered total');
  same(sum(x.turnout.map(p=>p.ballots)),x.ballots,'ballots total');
  return {mismatches,contests:x.contests.length,choices:x.contests.reduce((n,c)=>n+c.choices.length,0),precincts:x.turnout.length,rows:x.rows.length,registered:x.registered,ballots:x.ballots,votes:sum(x.contests.flatMap(c=>c.choices.map(ch=>ch.total))),certification:'not established'};
}
function reconcileContest(c:Contest,s:any,d:any,same:(a:unknown,b:unknown,where:string)=>void) {
  if(!s || !d) throw new Error('missing contest');
  const names=array(s.CH), votes=array(s.V), ps=array(d.P), dv=array(d.V), dt=array(d.T);
  parallel(names,votes);parallel(ps,dv,dt);unique(ps,label);
  same(names,c.choices.map(ch=>ch.name),`choice labels/order ${c.key}`);same(s.C,c.name,`contest label ${c.key}`);
  same(names.length,c.choices.length,`choice count ${c.key}`);
  same(count(s.T),sum(c.choices.map(ch=>ch.total)),`contest total ${c.key}`);
  same(count(s.TP),c.reporting,`reporting ${c.key}`);same(count(s.PR),c.reported,`reported ${c.key}`);
  c.choices.forEach((ch,i)=>{
    same(ch.total,count(votes[i]),`choice total ${c.key}/${ch.key}`);
    same(ch.total,sum(ch.types.map(v=>v.total)),`vote-type total ${c.key}/${ch.key}`);
    for(const v of ch.types){same(v.total,sum(v.precincts.map(p=>p.votes)),`precinct sum ${c.key}/${ch.key}/${v.name}`);same(v.precincts.map(p=>p.name),ps,`precinct labels ${c.key}/${ch.key}/${v.name}`);}
    ps.forEach((p,j)=>{const row=array(dv[j]);parallel(row,names);same(sum(ch.types.map(v=>{const found=v.precincts.find(k=>k.name===p);if(!found) throw new Error('missing XML precinct');return found.votes;})),count(row[i]),`detail votes ${c.key}/${ch.key}/${p}`);});
  });
  dv.forEach((row:any,j:number)=>same(sum(array(row).map(count)),count(dt[j]),`detail total ${c.key}/${ps[j]}`));
}
