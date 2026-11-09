import { expect,test } from "bun:test";
import {discover,sources,select} from "../src/adapters";
test("budgets use enclosing fiscal year and retain volume, language and paths outside planning_budget",()=>{
 const rows=discover("budgets",sources.budgets.pages[2],`<h2>Fiscal Year 2031 (Tax Year 2030)</h2><h3>Adopted Budget</h3><a href="/images/news/docs/volume.pdf">Volume IV – Español v2</a><h2>FY 2030</h2><a href="/images/impact.pdf">Taxpayer Impact Statement</a>`);
 expect(rows).toHaveLength(2);
 expect(rows[0]).toMatchObject({year:"2031",fiscalYear:"2031",taxYear:"2030",administeringCounty:"Travis",role:"adopted",volume:"IV",language:"Spanish",publicationDate:null});
 expect(rows[1]).toMatchObject({year:"2030",role:"taxpayer-impact"});
 expect(select(rows,{year:"2031",role:"adopted",limit:2})).toHaveLength(1);
});
test("closed minutes accordions preserve labels/month/year, deduplicate selection, and never repair anomalous dates",()=>{
 const rows=discover("meeting-archives",sources["meeting-archives"].pages[0],`<h3>2000</h3><div hidden><strong>January</strong><a href="/wp-content/uploads/commissioners_court/archives/2000/a.pdf">1.25.1000</a><a href="/wp-content/uploads/commissioners_court/archives/2000/b.pdf">1.5.2000 Special</a><a href="/wp-content/uploads/commissioners_court/archives/2000/b.pdf">1.5.2000 Special</a></div>`);
 expect(rows).toHaveLength(3);
 expect(rows[0]).toMatchObject({originalDate:"1.25.1000",date:null,year:"2000",role:"minutes"});
 expect(rows[0]!.headings).toContain("January");
 expect(rows[1]).toMatchObject({date:"2000-01-05",session:"Special"});
 expect(select(rows,{year:"2000",limit:10})).toHaveLength(2);
});
test("election same-page sections preserve official state independent of filename and jurisdiction",()=>{
 const rows=discover("election-documents",sources["election-documents"].pages[0],`<h2>2030 Travis County Official Results</h2><h3>Saturday, June, 11, 2030 Local Runoff Election</h3><a href="/wp-content/uploads/results.pdf">Cumulative</a><h2>2031 Unofficial Preliminary Reconciliation</h2><h3>May 3, 2031 City of Example Election</h3><a href="/wp-content/uploads/Final.pdf">Election Reconciliation – Unofficial Totals</a>`);
 expect(rows[0]).toMatchObject({date:"2030-06-11",year:"2030",state:"official",role:"cumulative",jurisdiction:null});
 expect(rows[1]).toMatchObject({state:"unofficial",role:"reconciliation",date:"2031-05-03",jurisdiction:"City of Example"});
});
