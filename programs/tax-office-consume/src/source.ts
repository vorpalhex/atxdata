import {parse} from 'csv-parse/sync';
export const HOST='https://tax-office.traviscountytx.gov';
export const ROUTES={robots:HOST+'/robots.txt',discovery:HOST+'/pages/property.php',csv:HOST+'/voterdata/TaxDelqOpenData.csv',layout:HOST+'/pages/DelinquentFileLayout.php'};
export const CAPS={csv:4*1024**2,layout:2*1024**2,discovery:2*1024**2,robots:2*1024**2,requests:8,rows:50000,total:16*1024**2};
export const HEADER=['Account #','Last Tax Roll Year ','Property Type Code','Land Value','Improvement Value','Ag Market','Appraisal Value','Ag Taxable Value','Assessed Value','Exemptions','Delinquent Total','Current Year Total','Total Due','Sequence #','1st Year Delinquent','Cause #','Judgement Date','Bankruptcy Number','Owner ID','Owner Name','Address 1','Address 2','Address 3','City','State','Zip Code','Country','Street Number','Street Name','Property Zip','Legal Description'];
export function cents(s:string):bigint {
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))throw new Error('decimal money');
 const [whole,frac='']=s.replace(/^-/,'').split('.');return (BigInt(whole!)*100n+BigInt(frac.padEnd(2,'0')))*(s.startsWith('-')?-1n:1n);
}
export function parseCsv(raw:Buffer,maxRows:number){
 if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>CAPS.rows)throw new Error('row ceiling');
 if(raw.length>CAPS.csv)throw new Error('CSV byte ceiling');
 const records=parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as string[][];
 if(JSON.stringify(records.shift())!==JSON.stringify(HEADER))throw new Error('header mismatch');
 if(!records.length||records.length>maxRows)throw new Error('row ceiling');
 return records.map(parseRow);
}
function parseRow(fields:string[],i:number){
 if(fields.length!==31)throw new Error('row width');
 if(!/^\d{14}$/.test(fields[0]!))throw new Error('account ID');
 validateBalances(fields);validateYears(fields);
 const year=fields[14]!;
 return {ordinal:i+1,fields,firstDelinquentYear:year===''||year==='0000'?null:year};
}
function validateBalances(fields:string[]){
 for(const n of [3,4,5,6,7,8,10,11,12])cents(fields[n]!);
 if(cents(fields[10]!)+cents(fields[11]!)!==cents(fields[12]!))throw new Error('balance disagreement');
}
function validateYears(fields:string[]){
 if(!/^\d{4}$/.test(fields[1]!)||!/^\d+$/.test(fields[13]!))throw new Error('roll year/sequence');
 const year=fields[14]!;if(year!==''&&!/^\d{4}$/.test(year))throw new Error('first year');
}

export function validatePdf(raw:Buffer){
 if(raw.length>CAPS.layout||!raw.subarray(0,8).toString().match(/^%PDF-1\.[0-9]/)||!raw.subarray(-2048).includes(Buffer.from('%%EOF')))throw new Error('invalid PDF');
 const check=Bun.spawnSync(['pdfinfo','-'],{stdin:raw,timeout:5000,maxBuffer:1048576});
 if(check.exitCode!==0)throw new Error('invalid PDF structure (pdfinfo required)');
 const extracted=Bun.spawnSync(['pdftotext','-layout','-','-'],{stdin:raw,timeout:5000,maxBuffer:128*1024});
 if(extracted.exitCode!==0)throw new Error('layout schema text extraction (pdftotext required)');
 validateLayoutText(extracted.stdout.toString());
}
function compact(text:string){return text.toLowerCase().replace(/[^a-z0-9]/g,'');}
export function validateLayoutText(text:string){
 if(Buffer.byteLength(text)>128*1024)throw new Error('layout schema text ceiling');
 const normalized=compact(text);let cursor=0;
 for(const name of HEADER){const field=compact(name),position=normalized.indexOf(field,cursor);if(position<0)throw new Error('layout schema field order');cursor=position+field.length;}
 for(const meaning of ['Column Headings','Data Type','Fourteen character reference number','Total Delinquent for all jurisdictions for all years','Number of delinquent sequences','Earliest delinquent year','Legal description of the property']){
  if(!normalized.includes(compact(meaning)))throw new Error('layout schema field meaning');
 }
}
