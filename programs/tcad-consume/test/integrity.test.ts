import {test,expect} from 'bun:test';import {withZip,inventory,integrity,LIMITS} from '../src/archive';import {readFile} from 'node:fs/promises';
const retained=process.env.TCAD_INPUTS?JSON.parse(await readFile(process.env.TCAD_INPUTS,'utf8')):null;
(retained?test:test.skip)('explicit integrity streams small retained layout members and enforces declared expansion budget',async()=>{
 await withZip(retained.layout,LIMITS.layout,async zip=>{const members=await inventory(zip);expect(await integrity(zip,members,LIMITS.layout,10)).toMatchObject({members:2});await expect(integrity(zip,members,1,10)).rejects.toThrow('total');});
});
