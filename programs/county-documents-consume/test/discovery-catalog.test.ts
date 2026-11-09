import {expect,test} from 'bun:test';
import * as discovery from '../src/discovery';
import {sources} from '../src/adapters';

test('historical catalog preserves actual selector tokens and unsupported links without inventing GET routes',()=>{
 expect(typeof discovery.catalog).toBe('function');
 const result=discovery.catalog('county-code',sources['county-code'].pages[0],'<a href="http://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx">Code Archives</a><a href="https://library.municode.com/tx/austin">Title 30</a><select id="old" name="archive"><option value="0"></option><option value="164">Ch_026_2026-09-15_Item_13 (9/15/2026)</option></select>');
 expect(result.selectors).toEqual([{id:'old',name:'archive',value:'164',label:'Ch_026_2026-09-15_Item_13 (9/15/2026)'}]);
 expect(result.blockedLinks.map(row=>row.href)).toEqual(['http://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx','https://library.municode.com/tx/austin']);
 expect(result.pages).toEqual([]);
});
