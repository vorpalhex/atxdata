import {expect,test} from "bun:test";
import {discover,sources,select,exactDate} from "../src/adapters";
test("selection keeps newest observation occurrence rather than last repeated URL",()=>{
 const rows=discover("county-code",sources["county-code"].pages[0],`<a href="/two.pdf">Chapter 2 NEW</a><a href="/two.pdf">Chapter 2 OLD</a>`);
 expect(select(rows,{limit:1})[0]!.label).toBe("Chapter 2 NEW");
 expect(exactDate("2030","2","31")).toBeNull();
 expect(exactDate("1800","1","1")).toBe("1800-01-01");
 expect(exactDate("1799","1","1")).toBeNull();
 expect(exactDate("oops","1","1")).toBeNull();
});
test("closed source accordion month label is retained even without a heading element",()=>{
 const rows=discover("meeting-archives",sources["meeting-archives"].pages[0],`<h3>2010</h3><div class="sow-accordion-panel"><div class="sow-accordion-title">January 2010</div><div hidden><a href="/wp-content/uploads/commissioners_court/archives/2010/a.pdf">1.5.2010</a></div></div>`);
 expect(rows[0]!.headings).toContain("January 2010");
 const code=discover("county-code",sources["county-code"].pages[0],`<h3>Title 1</h3><div class="accordion-group"><div class="accordion-heading"><a>Subtitle 1: Commissioners Court &amp; Code</a></div><div class="accordion-body"><a href="/two.pdf">Chapter 2</a></div></div>`);
 expect(code[0]!.headings).toContain("Subtitle 1: Commissioners Court & Code");
});
