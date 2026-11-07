import {readFile,unlink} from "node:fs/promises";
import {join} from "node:path";
import {statFile} from "../../civicclerk-consume/src/archive";
import {sha} from "./engine";
import {exactDate,type Evidence} from "./adapters";

const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
export function namedDate(raw:string|null):string|null {
 if(raw===null) return null;
 const match=/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw);
 if(!match) return null;
 return exactDate(match[3]!,String(MONTHS.findIndex(month=>month.toLowerCase()===match[1]!.toLowerCase())+1),match[2]!);
}
function numericDate(raw:string|null):string|null {
 if(raw===null) return null;
 const match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
 return match?exactDate(match[3]!,match[1]!,match[2]!):null;
}
export function legacyBodyEvidence(text:string) {
 const amendment=/Amended\s+through\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(text)?.[1]??null;
 const report=/Election Summary\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text)?.[1]??null;
 return {
  fiscalYear:/FISCAL YEAR\s+(\d{4})/i.exec(text)?.[1]??null,
  taxYear:/\bTAX YEAR\s+(\d{4})/i.exec(text)?.[1]??null,
  amendmentThroughOriginal:amendment,amendmentThrough:namedDate(amendment),
  reportDateOriginal:report,reportDate:numericDate(report),
  originalAttestationDate:null as string|null,attestationDate:null as string|null,
  publicationDate:null,contestJurisdiction:null as string|null,
 };
}
function matched(text:string,pattern:RegExp):string|null {
 return pattern.exec(text)?.[1]??null;
}
export function bodyEvidence(text:string) {
 const amendment=matched(text,/(?:Amended\s+through|Amendments?\s+added\s+through)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
 const chapter=matched(text,/Chapter\s+\d+\s+was\s+amended\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
 return {...legacyBodyEvidence(text),amendmentThroughOriginal:amendment,amendmentThrough:namedDate(amendment),chapterAmendmentOriginal:chapter,chapterAmendmentDate:namedDate(chapter)};
}
export function requirePdf(bytes:Uint8Array,mime:string):void {
 const checks=[mime.split(";")[0]?.trim().toLowerCase()==="application/pdf",bytes.length<=5*1024*1024,Buffer.from(bytes).subarray(0,5).equals(Buffer.from("%PDF-"))];
 if(!checks.every(Boolean)) throw new Error("invalid PDF MIME/magic/size");
}
export async function inspectPdf(path:string) {
 const info=await Bun.$`pdfinfo ${path}`.quiet().nothrow();
 const extracted=await Bun.$`pdftotext -f 1 -l 3 -layout ${path} -`.quiet().nothrow();
 if(info.exitCode!==0 || extracted.exitCode!==0) throw new Error("PDF parser failed");
 const pages=Number(/^Pages:\s+(\d+)/m.exec(info.text())?.[1]);
 if(!Number.isSafeInteger(pages) || pages<1) throw new Error("invalid PDF page count");
 return {info:info.text(),text:extracted.text(),pages};
}
const ROLE_TEXT:Record<string,RegExp>={
 "taxpayer-impact":/taxpayer\s+impact/i,"tax-rate":/tax|rate/i,"budget-in-brief":/budget[\s\S]*brief/i,
 recommendations:/recommend/i,guidelines:/guideline/i,rules:/rules/i,preliminary:/prelim/i,adopted:/adopted/i,
 reconciliation:/reconcil/i,cumulative:/summary|cumulative/i,precinct:/precinct/i,audit:/audit/i,certification:/certif/i,results:/results/i,
};
function dateMatches(text:string,date:string):boolean {
 const [year,month,day]=date.split("-");
 const numeric=new RegExp(`\\b(?:${month}|${Number(month)})[/.\\-](?:${day}|${Number(day)})[/.\\-]${year}\\b`);
 const named=new RegExp(`${MONTHS[Number(month)-1]}\\s+(?:${day}|${Number(day)}),?\\s+${year}\\b`,"i");
 return numeric.test(text)||named.test(text);
}
function publicationIdentity(text:string,row:Evidence):boolean {
 if(!["budgets","election-documents"].includes(row.source)) return true;
 const role=ROLE_TEXT[row.role]??/budget|tax/i;
 if(!role.test(text)) return false;
 if(row.source!=="election-documents") return true;
 if(row.date && !dateMatches(text,row.date)) return false;
 return row.state==="unknown" || new RegExp(`\\b${row.state}\\b`,"i").test(text);
}
function minutesIdentity(text:string,row:Evidence):boolean {
 const title=/^\s*MINUTES OF MEETING\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(text);
 const checks=[row.date!==null,namedDate(title?.[1]??null)===row.date,/TRAVIS COUNTY COMMISSIONERS[’']?\s*COURT/i.test(text),/Voting Session|Court convened/i.test(text)];
 return checks.every(Boolean);
}
function scopedIdentity(text:string,row:Evidence):boolean {
 switch(row.source) {
  case 'county-code': return /^\s*(?:Travis County\s+)?Chapter\s+(\d+)[.\s]/i.exec(text)?.[1]===row.chapter;
  case 'meeting-archives': return minutesIdentity(text,row);
  case 'budgets': return /(?:\bFISCAL YEAR|\bFY)\s*(\d{4})\b/i.exec(text.slice(0,512))?.[1]===row.year;
  case 'election-documents': return Boolean(row.year && text.includes(row.year));
 }
}
export function requireTextIdentity(text:string,row:Evidence):void {
 if(!/Travis/i.test(text) || !scopedIdentity(text,row) || !publicationIdentity(text,row)) throw new Error("PDF body identity unresolved; private rendered inspection required");
}
/** Only a small one-page identity review; not an OCR or corpus-render service. */
export async function renderIdentity(path:string,root:string):Promise<Buffer> {
 const prefix=join(root,crypto.randomUUID()+"-review"),output=prefix+".png";
 if(await statFile(output)) throw new Error("render output already exists");
 const result=await Bun.$`pdftoppm -f 1 -l 1 -singlefile -scale-to 1400 -png ${path} ${prefix}`.quiet().nothrow();
 if(result.exitCode!==0) throw new Error("render failed");
 try {
  await statFile(output);
  const image=await readFile(output);
  if(image.length>5*1024*1024) throw new Error("render size limit");
  return image;
 } finally {await unlink(output);}
}
export type RenderedReview={documentSha256:string;imageSha256:string;county:string;date:string;role:string;state:string;originalAttestationDate:string|null;attestationDate:string|null;note:string};
export function requireReview(review:RenderedReview,row:Evidence,bytes:Uint8Array,image:Uint8Array):void {
 const checks=[review.documentSha256===sha(bytes),review.imageSha256===sha(image),review.county==="Travis",review.date===row.date,review.role===row.role,review.state===row.state,typeof review.note==="string" && review.note.trim().length>0,row.source==="election-documents"];
 if(!checks.every(Boolean)) throw new Error("rendered review identity mismatch");
}
