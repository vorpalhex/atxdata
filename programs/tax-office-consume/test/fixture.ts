import {HEADER} from '../src/source';
// Synthetic, non-record PDF. No retained source bytes or owner data.
export function validPdf(schema=true){
 const text=schema?['Column Headings Data Type',...HEADER,'Fourteen character reference number','Total Delinquent for all jurisdictions for all years','Number of delinquent sequences','Earliest delinquent year','Legal description of the property']:[];
 const stream='BT /F1 6 Tf 10 780 Td '+text.map(t=>'('+t.replace(/[()\\]/g,'\\$&')+') Tj 0 -12 Td').join('\n')+' ET';
 const bodies=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let s='%PDF-1.4\n';const offsets=[0];
 for(const [i,body] of bodies.entries()){offsets.push(s.length);s+=`${i+1} 0 obj\n${body}\nendobj\n`;}
 const start=s.length;s+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`;for(const n of offsets.slice(1))s+=String(n).padStart(10,'0')+' 00000 n \n';return Buffer.from(s+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
