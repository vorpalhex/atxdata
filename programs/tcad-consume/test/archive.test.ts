import {test,expect} from 'bun:test';
import {safeMember,checkInventory} from '../src/archive';
const member=(name:string,size=1)=>({name,size,compressed:1,crc:0,method:8,flags:0,attributes:0,ordinal:1});
test('expansion boundaries are inclusive while invalid metadata and empty/overfull inventories fail',()=>{
 for(const size of [0,10*1024**3])expect(()=>safeMember(member('A',size))).not.toThrow();
 expect(()=>safeMember({...member('A'),method:0})).not.toThrow();expect(()=>safeMember({...member('A'),attributes:0x8000<<16})).not.toThrow();
 for(const size of [-1,NaN,0.5,Infinity])expect(()=>safeMember(member('A',size))).toThrow();
 for(const name of ['', 'bad\u0000name','a/','a/./b'])expect(()=>safeMember(member(name))).toThrow();
 expect(()=>checkInventory([member('A')])).not.toThrow();expect(()=>checkInventory([])).toThrow();expect(()=>checkInventory(Array.from({length:64},(_,i)=>member('n'+i)))).not.toThrow();expect(()=>checkInventory(Array.from({length:65},(_,i)=>member('n'+i)))).toThrow();expect(()=>checkInventory([member('A',10*1024**3),member('B',10*1024**3)])).not.toThrow();
});
test('ZIP member names, types, encryption and expansion ceilings fail closed',()=>{
 for(const name of ['../escape','/absolute','C:/drive','dir\\file','a/../b','a//b','./dot'])expect(()=>safeMember(member(name))).toThrow();
 for(const change of [{size:10*1024**3+1},{flags:1},{method:99},{attributes:0xa000<<16}])expect(()=>safeMember({...member('PROP.TXT'),...change})).toThrow();
 expect(()=>safeMember(member('PROP.TXT'))).not.toThrow();
 expect(()=>checkInventory([member('PROP.TXT'),member('PROP.TXT')])).toThrow('duplicate');expect(()=>checkInventory([member('A',10*1024**3),member('B',10*1024**3),member('C')])).toThrow('total');
});
