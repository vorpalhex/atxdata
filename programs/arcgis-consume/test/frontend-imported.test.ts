import {test,expect} from 'bun:test';
import {main,parseArgs} from '../src/cli';

const commands=['list','rules','discover','collect','sync','status','verify'];
test('imported contextual help preserves command and information precedence',async()=>{
 await expect(main([])).rejects.toThrow('Usage:');
 for(const command of commands) {
  for(const args of [[command,'-h'],['help',command],[command,'--help']]) {
   const result=await main([...args,'--archive','/dev/null']);
   expect(result).toContain(`ArcGIS ${command}\nUsage:`);
   expect(result).toContain('catalogTerms');
  }
 }
 expect(await main(['help'])).toContain('Usage:');
 for(const args of [['--bogus','--help'],['status','--archive','a','--archive','b','--help']]) expect(await main(args)).toContain('Usage:');
 expect(await main(['--help','--version'])).toBe('arcgis-consume 0.1.0');
 expect(await main(['--version','--help'])).toContain('Usage:');
 await expect(main(['help','unknown'])).rejects.toThrow('unknown command');
 await expect(main(['--bogus','unknown','--help'])).rejects.toThrow('unknown command');
});

test('imported token consumption preserves literal values, terminators and first error',async()=>{
 const cases:[string[],string][]=[
  [['--archive','--help'],'missing --archive value'],
  [['--archive=--help'],'Usage:'],
  [['--','--help'],'unexpected operand'],
  [['--','status'],'unexpected operand'],
  [['help','help'],'unknown command'],
  [['list','extra'],'unexpected operand'],
  [['list','--bogus','--archive='],'unknown option'],
  [['list','--archive=','--bogus'],'missing --archive value'],
  [['list','--source','tnr','--source','voter'],'duplicate option'],
 ];
 for(const [args,message] of cases) await expect(main(args)).rejects.toThrow(message);
 for(const value of ['--version','--']) await expect(main(['status','--archive',value])).rejects.toThrow('missing --archive value');
 for(const value of ['help','list','status','-h']) await expect(main(['--source',value])).rejects.toThrow('Usage:');
});

test('imported selection wrapper retains equals/split, layer zero, presets and validation order',async()=>{
 const base=['collect','--archive=/private-placeholder','--source=tnr','--terms-sha256='+'a'.repeat(64)];
 const preset=parseArgs(base);
 expect(preset).toMatchObject({command:'collect',source:'tnr',legacyPreset:true,selection:{layer:0}});
 const selected=parseArgs([...base,'--item='+'d'.repeat(32),'--layer','0','--page-size=4','--fields','FID,LABEL']);
 expect(selected).toMatchObject({legacyPreset:false,selection:{item:'d'.repeat(32),layer:0,pageSize:4,fields:['FID','LABEL']}});
 expect(parseArgs(['--source','voter','list'])).toMatchObject({command:'list',legacyPreset:true});
 expect(await main(['list'])).toEqual(await main(['--source=tnr','list']));
 for(const n of ['0','-1','1.5','NaN','9007199254740992']) expect(()=>parseArgs([...base,'--page-size='+n])).toThrow();
 expect(()=>parseArgs(['collect','--archive=relative','--source=invalid'])).toThrow('--archive must be absolute');
 expect(()=>parseArgs(['collect','--archive=/private-placeholder','--source=invalid'])).toThrow();
 expect(()=>parseArgs(base.map(s=>s.startsWith('--terms-sha256=')?'--terms-sha256=bad':s))).toThrow('review rules');
 expect(()=>parseArgs([...base,'--resume=bad'])).toThrow('invalid run identifier');
});
