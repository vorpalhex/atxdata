import {test,expect} from 'bun:test';
import {catalog,decode,CAPS} from '../src/source';
import {count,parseXml,xmlFromZip,reconcile} from '../src/results';
import {zip,xml,summary,details,status} from './results.test';
const entry={State:'TX',StateId:'9',County:'Travis',CountyId:'1239',EID:'125662',ElectionName:'Test',Date:'12/13/2025'};
test('catalog identities, decoded limits and numeric values reject each malformed field independently',()=>{
 for(const field of ['State','StateId','County','CountyId','ElectionName','Date'])expect(()=>catalog([{...entry,[field]:false}])).toThrow();
 expect(()=>catalog(null)).toThrow();
 const full=Array.from({length:100},(_,i)=>({...entry,EID:String(i)}));expect(catalog(full).length).toBe(100);expect(()=>catalog([...full,{...entry,EID:'101'}])).toThrow();
 expect(decode(Buffer.alloc(3),'identity',3).bytes.length).toBe(3);expect(decode(Buffer.alloc(3),null,3).bytes.length).toBe(3);expect(()=>decode(Buffer.alloc(4),'identity',3)).toThrow();expect(()=>decode(Buffer.alloc(1),'br')).toThrow();
 for(const value of [null,true,false,{},[],1.2,-1,Number.MAX_SAFE_INTEGER+1,'-1','1.2','NaN',''])expect(()=>count(value)).toThrow();
 expect(count(0)).toBe(0);expect(count('001')).toBe(1);
});
test('ZIP header and XML boundary tampering fail closed without extracting a member',()=>{
 const good=zip(xml),c=40+Buffer.byteLength(xml),e=good.length-22;
 for(const offset of [0,4,6,8,14,18,22,26,28,c,c+8,c+10,c+16,c+20,c+24,c+28,c+30,c+34,c+42,c+46,e,e+4,e+8,e+10,e+12,e+16,e+20]){
  const b=Buffer.from(good);b[offset]^=1;
  // ZIP versions are metadata, not an integrity assertion.
  if(offset===4)continue;
  expect(()=>xmlFromZip(b)).toThrow();
 }
 expect(()=>xmlFromZip(zip(''))).toThrow();expect(()=>parseXml('<ElectionResult>')).toThrow();expect(()=>parseXml('<other/>')).toThrow();
 expect(()=>parseXml(xml.replace('text="Choice"','text=""'))).toThrow();
 for(const change of [xml.replace(/<Contest.*<\/Contest>/,''),xml.replace(/<Choice.*<\/Choice>/,''),xml.replace(/<Precinct name="001" votes="2"\/>/,''),xml.replace('<Precincts>','<Other>').replace('</Precincts>','</Other>')])expect(()=>parseXml(change)).toThrow();
});
test('every aggregate and parallel array mismatch is retained or rejected explicitly',()=>{
 const x=parseXml(xml);
 expect(()=>reconcile(x,summary,{Contests:[]},status)).toThrow();
 expect(()=>reconcile(x,summary,details,{...status,B:[]})).toThrow();
 expect(()=>reconcile(x,summary,{Contests:[{...details.Contests[0],V:[[2,3]]}]},status)).toThrow();
 for(const field of ['T','TP','PR'])expect(reconcile(x,[{...summary[0],[field]:9}],details,status).mismatches.length).toBeGreaterThan(0);
 for(const field of ['R','B','S'])expect(reconcile(x,summary,details,{...status,[field]:[9]}).mismatches.length).toBeGreaterThan(0);
 expect(reconcile(x,summary,{Contests:[{...details.Contests[0],T:[9]}]},status).mismatches.length).toBeGreaterThan(0);
});
