import {test,expect} from 'bun:test';
import {HEADER,parseCsv,validatePdf,cents,CAPS} from '../src/source';
import {validPdf} from './fixture';
function csv(changes:Record<number,string>={}){
 const row=HEADER.map(()=> '');Object.assign(row,{0:'00000000000001',1:'2025',3:'0',4:'0',5:'0',6:'0',7:'0',8:'0',10:'0.10',11:'0.20',12:'0.30',13:'1',14:'0000'},changes);
 return Buffer.from('\ufeff'+HEADER.join(',')+'\r\n'+row.join(',')+'\r\n');
}
test('preserves account and exact trailing-space header, uses decimal equality and unknown first year',()=>{
 const x=parseCsv(csv(),1);expect(x[0]!.fields[0]).toBe('00000000000001');expect(x[0]!.firstDelinquentYear).toBeNull();expect(x[0]!.fields[14]).toBe('0000');expect(HEADER[1]).toBe('Last Tax Roll Year ');
});
test('rejects money disagreement, bad IDs, row bounds and changed schema',()=>{
 expect(()=>parseCsv(csv({12:'0.31'}),1)).toThrow('balance');expect(()=>parseCsv(csv({0:'123'}),1)).toThrow('account');expect(()=>parseCsv(csv(),0)).toThrow('row');expect(()=>parseCsv(Buffer.from(csv().toString().replace('Last Tax Roll Year ','Last Tax Roll Year')),1)).toThrow('header');
});
test('numeric signs, bounds, ordinals and noninvented years are observable',()=>{
 expect(cents('12.34')).toBe(1234n);expect(cents('-12.34')).toBe(-1234n);expect(cents('12')).toBe(1200n);
 for(const bound of [-1,0,0.5,NaN,CAPS.rows+1])expect(()=>parseCsv(csv(),bound)).toThrow('row');
 expect(parseCsv(csv(),CAPS.rows)).toHaveLength(1);
 expect(parseCsv(csv({14:'1999'}),1)[0]).toMatchObject({ordinal:1,firstDelinquentYear:'1999'});expect(parseCsv(csv({14:''}),1)[0]!.firstDelinquentYear).toBeNull();
 expect(()=>parseCsv(csv({14:'oops'}),1)).toThrow('first year');expect(()=>parseCsv(csv({1:'nope'}),1)).toThrow('roll year');expect(()=>parseCsv(csv({13:'one'}),1)).toThrow('sequence');
 expect(()=>parseCsv(Buffer.from(HEADER.join(',')+'\r\n'),1)).toThrow('row');
 const bad=Buffer.concat([csv().subarray(0,-2),Buffer.from([255]),Buffer.from('\r\n')]);expect(()=>parseCsv(bad,1)).toThrow();
 const max=csv({30:'a'.repeat(CAPS.csv-csv().length)});expect(max.length).toBe(CAPS.csv);expect(parseCsv(max,1)).toHaveLength(1);expect(()=>parseCsv(Buffer.concat([max,Buffer.from('x')]),1)).toThrow('byte ceiling');
});
test('validates actual PDF rather than documented octet-stream MIME',()=>{
 expect(()=>validatePdf(Buffer.from('<html>gate</html>'))).toThrow('PDF');
 expect(()=>validatePdf(validPdf())).not.toThrow();
 const pad=(size:number)=>{const raw=Buffer.alloc(size,10);validPdf().copy(raw);const footer=Buffer.from('startxref\n'+validPdf().toString().match(/startxref\n(\d+)/)![1]+'\n%%EOF\n');footer.copy(raw,size-footer.length);return raw;};
 expect(()=>validatePdf(pad(CAPS.layout))).not.toThrow();expect(()=>validatePdf(pad(CAPS.layout+1))).toThrow('PDF');
 expect(()=>validatePdf(Buffer.from(validPdf().toString().replace('%%EOF','gone')))).toThrow('PDF');
});
