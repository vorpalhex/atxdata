import {test,expect} from 'bun:test';
import {discover} from '../src/adapters';
import {requireTextIdentity} from '../src/pdf';
import {redirectTarget} from '../src/redirects';
const source='austin-financial-publications';
const row=discover(source,'https://www.austintexas.gov/budget-excellence/data-and-insights','<h2>FY 2031</h2><a href="https://services.austintexas.gov/edims/document.cfm?id=123456">Quarterly Financial Report</a>')[0]!;
test('Austin PDF requires leading city publisher, fiscal year and publication role together',()=>{
 expect(()=>requireTextIdentity('City of Austin Quarterly Financial Report Fiscal Year 2031',row)).not.toThrow();
 for(const text of ['Travis County Quarterly Financial Report Fiscal Year 2031','City of Austin Quarterly Financial Report Fiscal Year 2030','City of Austin Monthly Financial Report Fiscal Year 2031','Unrelated body. City of Austin Quarterly Financial Report Fiscal Year 2031']) expect(()=>requireTextIdentity(text,row)).toThrow(/identity/);
});
test('canonical Council redirects are route-general, same authority, never synthesized year URLs',()=>{
 for(const year of ['1869','1912']) expect(redirectTarget(source,`https://www.austintexas.gov/council/archive/${year}_council_index`,302,`/content/archive-council-meetings-held-${year}`,'page')).toBe(`https://www.austintexas.gov/content/archive-council-meetings-held-${year}`);
 for(const target of ['https://other.invalid/robots.txt','https://www.austintexas.gov/robots.txt?x=1','https://user@www.austintexas.gov/robots.txt']) expect(()=>redirectTarget(source,'https://services.austintexas.gov/robots.txt',302,target,'robots')).toThrow();
 expect(()=>redirectTarget('budgets','https://services.austintexas.gov/robots.txt',302,'https://www.austintexas.gov/robots.txt','robots')).toThrow();
 expect(()=>redirectTarget(source,'https://www.austintexas.gov/financial-services/bonds',302,'https://www.austintexas.gov/content/archive-council-meetings-held-1869','page')).toThrow();
});
