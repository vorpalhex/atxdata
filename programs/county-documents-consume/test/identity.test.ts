import {expect,test} from "bun:test";
import {discover,sources} from "../src/adapters";
import {requireTextIdentity} from "../src/pdf";
test("text identity rejects same county/year with wrong role or election date",()=>{
 const budget=discover('budgets',sources.budgets.pages[0],'<h1>FY 2031</h1><a href="/impact.pdf">Taxpayer Impact Statement</a>')[0]!;
 expect(()=>requireTextIdentity('Travis County FY 2031 unrelated report',budget)).toThrow();
 expect(()=>requireTextIdentity('Travis County FISCAL YEAR 2031 TAXPAYER IMPACT STATEMENT',budget)).not.toThrow();
 const election=discover('election-documents',sources['election-documents'].pages[0],'<h2>2031 Official Results</h2><h3>June 11, 2031 Local Election</h3><a href="/r.pdf">Election Reconciliation – Official Totals</a>')[0]!;
 expect(()=>requireTextIdentity('Travis County Election Reconciliation Official Totals 06/12/2031',election)).toThrow();
 expect(()=>requireTextIdentity('Travis County Election Reconciliation Official Totals 06/11/2031',election)).not.toThrow();
});
