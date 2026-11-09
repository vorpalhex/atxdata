import { expect, test } from "bun:test";
import { discover, sources, select } from "../src/adapters";

test("current code chapters retain hierarchy, sparse numbers and occurrences, excluding footer and Title30", () => {
 const page = `<h2>County Code</h2><h3>Title 1: Administrative Code</h3><p><strong>Subtitle 1: General</strong></p><a href="/images/2.pdf">Chapter 2 Code Interpretation</a><a href="/images/464.pdf">Chapter 464 Flood Plain</a><a href="/images/2.pdf">Chapter 2 repeated label</a><h3>Title 30: joint code</h3><a href="/joint.pdf">Joint code</a><footer><a href="/org.pdf">Org Chart</a></footer>`;
 const rows = discover("county-code", sources["county-code"].pages[0]!, page);
 expect(rows).toHaveLength(3);
 expect(rows[0]).toMatchObject({chapter:"2",role:"chapter",label:"Chapter 2 Code Interpretation",publicationDate:null});
 expect(rows[0]!.headings.join(" | ")).toContain("Subtitle 1: General");
 expect(select(rows,{chapter:"464",limit:1})).toHaveLength(1);
 expect(select(rows,{chapter:"3",limit:1})).toEqual([]);
 expect(() => select(rows,{limit:0})).toThrow();
});
