import {test,expect} from 'bun:test';import {crc32} from 'node:zlib';import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';import {join} from 'node:path';import {withZip,inventory,readMember,integrity,digest} from '../src/archive';
function zipBytes(corrupt=false){
 const name=Buffer.from('PROP.TXT'),data=Buffer.from('synthetic test payload'),crc=crc32(data),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);if(corrupt)data[0]=120;
 return Buffer.concat([local,name,data,central,name,end]);
}
test('synthetic ZIP corruption and malformed prefixes fail offline integrity, without blind extraction',async()=>{
 const base=await mkdtemp(join(process.env.TMPDIR!,'tcad-zip-'));try{
  for(const corrupt of [false,true]){const path=join(base,String(corrupt)+'.zip');await writeFile(path,zipBytes(corrupt));await withZip(path,1000,async zip=>{const members=await inventory(zip);if(corrupt){await expect(readMember(zip,members[0]!,1000)).rejects.toThrow('CRC');await expect(integrity(zip,members,1000,10)).rejects.toThrow('CRC');}else{expect((await readMember(zip,members[0]!,1000)).toString()).toBe('synthetic test payload');await expect(readMember(zip,members[0]!,1000,true)).rejects.toThrow('short');}});}
  await symlink(join(base,'false.zip'),join(base,'link.zip'));await expect(digest(join(base,'link.zip'),1000)).rejects.toThrow('symlink');await expect(digest(join(base,'false.zip'),1)).rejects.toThrow('ceiling');
 }finally{await rm(base,{recursive:true,force:true});}
});
