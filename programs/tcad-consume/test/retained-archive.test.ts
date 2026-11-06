import {test,expect} from 'bun:test';import {withZip,inventory,readMember,digest} from '../src/archive';import {readFile} from 'node:fs/promises';
const retained=process.env.TCAD_INPUTS?JSON.parse(await readFile(process.env.TCAD_INPUTS,'utf8')):null;
(retained?test:test.skip)('retained archive metadata is bounded and Property reads only a 25-row prefix',async()=>{
 expect(await digest(retained.archive,671088640)).toBe(retained.archive_sha256);
 await withZip(retained.archive,671088640,async zip=>{const entries=await inventory(zip);expect(entries).toHaveLength(21);expect(entries.reduce((n,e)=>n+e.size,0)).toBe(17989848588);const prop=entries.find(e=>e.name==='PROP.TXT')!;const prefix=await readMember(zip,prop,25*9924,true);expect(prefix).toHaveLength(25*9924);expect(prefix.subarray(9922,9924).toString()).toBe('\r\n');});
});
