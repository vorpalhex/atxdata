/** Fully authored valid PDF with an uncompressed RGB image, never a partial source PDF. */
export function authoredLargePdf():Buffer {
 const image=Buffer.alloc(1450*1450*3,120);
 const content=Buffer.from('BT /F1 12 Tf 10 180 Td (Travis County Chapter 2 Code Interpretation) Tj ET\nq 380 0 0 150 10 10 cm /Im1 Do Q');
 const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`),content,Buffer.from('\nendstream')]),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1450 /Height 1450 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.length} >>\nstream\n`),image,Buffer.from('\nendstream')])];
 const chunks=[Buffer.from('%PDF-1.4\n')],offsets:number[]=[];
 let length=chunks[0]!.length;
 for(const [index,object] of objects.entries()) {offsets.push(length);const chunk=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;}
 chunks.push(Buffer.from('xref\n0 7\n0000000000 65535 f \n'+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
 return Buffer.concat(chunks);
}
