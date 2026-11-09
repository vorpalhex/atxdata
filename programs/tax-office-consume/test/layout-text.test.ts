import {test,expect} from 'bun:test';import {HEADER,validateLayoutText} from '../src/source';
const meanings='Column Headings Data Type Fourteen character reference number Total Delinquent for all jurisdictions for all years Number of delinquent sequences Earliest delinquent year Legal description of the property';
test('layout matching accepts a first-field offset of zero and rejects reordered labels and missing meaning',()=>{
 const text=HEADER.join(' ');expect(()=>validateLayoutText(text+' '+meanings)).not.toThrow();
 const reordered=[...HEADER];[reordered[4],reordered[5]]=[reordered[5]!,reordered[4]!];expect(()=>validateLayoutText(reordered.join(' ')+' '+meanings)).toThrow('layout schema');
 expect(()=>validateLayoutText(text)).toThrow('layout schema');
});
test('extracted layout text has an explicit byte ceiling independent of subprocess buffering',()=>{
 const valid=HEADER.join(' ')+' '+meanings;
 expect(()=>validateLayoutText(valid.padEnd(128*1024,' '))).not.toThrow();
 expect(()=>validateLayoutText(valid+'x'.repeat(128*1024))).toThrow('layout schema text ceiling');
});
