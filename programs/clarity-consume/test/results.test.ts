import { test, expect } from 'bun:test';
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
 expect(()=>xmlFromZip(zip('x'.repeat(100001)))).toThrow();
 expect(()=>xmlFromZip(zip(xml).subarray(0,-1))).toThrow();
 expect(()=>parseXml('<!DOCTYPE x [<!ENTITY a "b">]>'+xml)).toThrow();
 expect(()=>parseXml(xml.replace('votes="2"','votes="-1"'))).toThrow();
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
