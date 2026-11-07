import {expect,test} from 'bun:test';
import {requireTextIdentity} from '../src/pdf';
import {discover,sources,type Evidence} from '../src/adapters';
function row(source:keyof typeof sources,html:string):Evidence{return discover(source,sources[source].pages[0],html)[0]!;}
const code=row('county-code','<a href="/2.pdf">Chapter 2</a>');
const minutes=row('meeting-archives','<h3>2010</h3><a href="/wp-content/uploads/commissioners_court/archives/2010/m.pdf">1.12.2010</a>');
const budget=row('budgets','<h2>Fiscal Year 2026</h2><a href="/impact.pdf">Taxpayer Impact Statement</a>');
for(const [name,text,e] of [
 ['chapter','Chapter 464. Floodplain Management\nTravis County\n2 incidental',code],
 ['minutes','MINUTES OF MEETING JANUARY 5, 2010\nTRAVIS COUNTY COMMISSIONERS COURT\nVoting Session',minutes],
 ['fiscal year','FISCAL YEAR 2027 TAX YEAR 2026\nTRAVIS COUNTY TAXPAYER IMPACT STATEMENT\nFiscal Year 2026 Tax Information',budget],
] as const) test(`strict scoped ${name} identity rejects incidental match`,()=>expect(()=>requireTextIdentity(text,e)).toThrow('identity'));
test('title date controls known minutes conflict without rewriting body',()=>{
 const e={...minutes,date:'2010-01-05',year:'2010'};
 expect(()=>requireTextIdentity('MINUTES OF MEETING JANUARY 5, 2010\nTRAVIS COUNTY COMMISSIONERS COURT\nOn Tuesday the 2nd day of January 2010, convened Voting Session',e)).not.toThrow();
});
