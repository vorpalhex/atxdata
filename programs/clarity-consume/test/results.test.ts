import { test, expect } from 'bun:test';
import {CAPS} from '../src/source';
import { crc32 } from 'node:zlib';
import { xmlFromZip, parseXml, reconcile } from '../src/results';
export function zip(xml:string, name='detail.xml'): Buffer {
  const data=Buffer.from(xml), n=Buffer.from(name), local=Buffer.alloc(30), central=Buffer.alloc(46), end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt32LE(crc32(data),14); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(n.length,26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,6); central.writeUInt32LE(crc32(data),16); central.writeUInt32LE(data.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(n.length,28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+n.length,12); end.writeUInt32LE(local.length+n.length+data.length,16);
  return Buffer.concat([local,n,data,central,n,end]);
}
export const xml='<ElectionResult><Timestamp>source time</Timestamp><ElectionName>Test</ElectionName><ElectionDate>12/13/2025</ElectionDate><Region>Travis</Region><VoterTurnout totalVoters="5" ballotsCast="3"><Precincts><Precinct name="001" totalVoters="5" ballotsCast="3" percentReporting="1"/></Precincts></VoterTurnout><Contest key="0004" text="Contest" precinctsReporting="1" precinctsReported="0"><Choice key="001" text="Choice" totalVotes="2"><VoteType name="Mail" votes="2"><Precinct name="001" votes="2"/></VoteType></Choice></Contest></ElectionResult>';
export const summary=[{K:'0004',C:'Contest',CH:['Choice'],V:[2],T:2,TP:1,PR:0}];
export const details={Contests:[{K:'0004',P:['001'],V:[[2]],T:[2]}]};
export const status={P:['001'],R:[5],B:[3],S:[1],C:[0]};
test('ZIP CRC, member names, decompression and forbidden XML declarations fail closed',()=>{
 expect(xmlFromZip(zip(xml))).toBe(xml);
 expect(()=>xmlFromZip(zip(xml,'../detail.xml'))).toThrow();
 const bad=zip(xml); bad[50]^=1; expect(()=>xmlFromZip(bad)).toThrow();
 expect(()=>xmlFromZip(zip('x'.repeat(CAPS.xmlBytes+1)))).toThrow();
 expect(()=>xmlFromZip(zip(xml).subarray(0,-1))).toThrow();
 expect(()=>parseXml('<!DOCTYPE x [<!ENTITY a "b">]>'+xml)).toThrow();
 expect(()=>parseXml(xml.replace('votes="2"','votes="-1"'))).toThrow();
});
test('ZIP UTF8 filename flag is supported, other flag bits remain forbidden',()=>{
 const c=40+Buffer.byteLength(xml),b=zip(xml);b.writeUInt16LE(0x800,6);b.writeUInt16LE(0x800,c+8);
 expect(xmlFromZip(b)).toBe(xml);
 for(const flag of [1,8,0x801,0x808]){b.writeUInt16LE(flag,6);b.writeUInt16LE(flag,c+8);expect(()=>xmlFromZip(b)).toThrow();}
});
test('summary contest total accepts a scalar or one count only, preserving disagreements',()=>{
 const x=parseXml(xml);
 expect(reconcile(x,[{...summary[0],T:[2]}],details,status).mismatches).toEqual([]);
 expect(reconcile(x,[{...summary[0],T:[3]}],details,status).mismatches).toContain('contest total 0004');
 for(const bad of [[],[2,3],[-1],['1.2']])expect(()=>reconcile(x,[{...summary[0],T:bad}],details,status)).toThrow();
});
test('contest key sets reconcile summary and detail permutations without changing raw order',()=>{
 const x=parseXml(xml.replace('</ElectionResult>',xml.match(/<Contest.*<\/Contest>/)![0].replace('key="0004"','key="0005"')+'</ElectionResult>'));
 const s=[summary[0],{...summary[0],K:'0005'}],d=[details.Contests[0],{...details.Contests[0],K:'0005'}];
 for(const [ss,dd] of [[s,d],[[...s].reverse(),d],[s,[...d].reverse()],[[...s].reverse(),[...d].reverse()]]){
  const before=JSON.stringify({x,ss,dd});
  expect(reconcile(x,ss,{Contests:dd},status).mismatches).toEqual([]);
  expect(JSON.stringify({x,ss,dd})).toBe(before);
 }
 for(const side of ['summary','detail']){
  expect(()=>reconcile(x,side==='summary'?s.slice(1):s,{Contests:side==='detail'?d.slice(1):d},status)).toThrow('missing contest');
  expect(()=>reconcile(x,side==='summary'?[...s,s[0]]:s,{Contests:side==='detail'?[...d,d[0]]:d},status)).toThrow('duplicate source key');
  const extra=reconcile(x,side==='summary'?[...s,{...s[0],K:'0006'}]:s,{Contests:side==='detail'?[...d,{...d[0],K:'0006'}]:d},status);
  expect(extra.mismatches).toContain(side+' contest keys');
 }
 expect(reconcile(x,s,{Contests:[d[0],{...d[1],V:[[3]]}]},status).mismatches).toContain('detail votes 0005/001/001');
 expect(reconcile({...x,registered:6},s,{Contests:d},status).mismatches).toEqual(['registered total']);
});
test('scoped string identities and vote/turnout sums reconcile, disagreements remain explicit',()=>{
 const result=parseXml(xml);
 expect(result.rows[0]).toEqual({contest:'0004',choice:'001',voteType:'Mail',precinct:'001',votes:2});
 const ok=reconcile(result,summary,details,status);
 expect(ok.mismatches).toEqual([]); expect(ok.ballots).toBe(3); expect(ok.votes).toBe(2);
 expect(reconcile(result,[{...summary[0],V:[3]}],details,status).mismatches.length).toBeGreaterThan(0);
 expect(()=>reconcile(result,summary,{Contests:[{...details.Contests[0],V:[]}]},status)).toThrow();
 expect(()=>parseXml(xml.replace('</VoteType>','<Precinct name="001" votes="0"/></VoteType>'))).toThrow();
});
