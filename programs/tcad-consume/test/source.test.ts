import {test,expect} from 'bun:test';import {readFile} from 'node:fs/promises';import {withZip,inventory,readMember,LIMITS} from '../src/archive';import {parseLayout,propertyRow,SELECTION,readSelection} from '../src/source';
const retained=process.env.TCAD_INPUTS?JSON.parse(await readFile(process.env.TCAD_INPUTS,'utf8')):null;
(retained?test:test.skip)('reproduces 493 contiguous fields and first 25 certified rows without ID coercion',async()=>{
 const x=await readSelection(retained.archive,retained.layout,SELECTION,25);
 expect(x.fields).toHaveLength(493);expect(x.rows).toHaveLength(25);expect(x.rows.every(r=>r.reason===null)).toBe(true);expect(x.rows[0]!.keys.year).toBe('02026');expect(x.rows[0]!.keys.supplement).toBe('000000000000');expect(x.raw).toHaveLength(248100);
 expect(propertyRow(Buffer.from('short'),1,x.fields).reason).toBe('row_width');
 const bad=Buffer.from(x.raw.subarray(0,9924));bad.fill(120,17,22);expect(propertyRow(bad,1,x.fields).reason).not.toBeNull();
 await expect(readSelection(retained.archive,retained.layout,'all',25)).rejects.toThrow('selection');await expect(readSelection(retained.archive,retained.layout,SELECTION,26)).rejects.toThrow('25');expect(()=>parseLayout('bad layout')).toThrow('493');
});
