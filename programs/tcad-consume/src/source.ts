import {withZip,inventory,readMember,digest,serialized,LIMITS} from './archive';
export const SELECTION='2026-certified-supp0-property-first25';
export const ARCHIVE_HASH='62d0d1cd22b03f31db8d3986160eb181c5d00044df98a303fce9e17a44e9aa02';
export const LAYOUT_HASH='c51352d2eba2f436c82b88ad156ebcc9a1d9c7fd546aee06bcfc83e69d61535b';
export const URLS={discovery:'https://traviscad.org/publicinformation',archive:'https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip',layout:'https://traviscad.org/wp-content/largefiles/Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip'};
export type Field={name:string;kind:string;start:number;end:number;length:number};
export function parseLayout(text:string):Field[]{
 const fields:Field[]=[];
 for(const line of text.split(/\r?\n/)){const m=/^(\w+)\s+(int|numeric|char|varchar|datetime|date|decimal|bit|filler)\s*(?:\([^)]*\))?\s+(\d+)\s+(\d+)\s+(\d+)\s*(.*)/.exec(line);if(m)fields.push({name:m[1]!,kind:m[2]!,start:Number(m[3]),end:Number(m[4]),length:Number(m[5])});}
 validateFields(fields);return fields;
}
function validateFields(fields:Field[]){
 if(fields.length!==493||fields[0]!.start!==1||fields[492]!.end!==9922)throw new Error('493-field/9922-byte layout required');
 let next=1;const names=new Set<string>();for(const f of fields){validateField(f,next,names);names.add(f.name);next=f.end+1;}
 for(const name of ['prop_id','prop_val_yr','sup_num','geo_id','py_owner_id','appraised_val','assessed_val'])if(!names.has(name))throw new Error('layout key identity');
}
function validateField(f:Field,next:number,names:Set<string>){if(f.start!==next||f.end-f.start+1!==f.length||(names.has(f.name)&&f.name!=='filler'))throw new Error('layout contiguity/identity');}
function fieldValues(raw:Buffer,fields:Field[]){
 const values:string[]=[];let reason:string|null=raw.some(b=>b>127)?'non_ascii':null;
 for(const f of fields){const value=raw.subarray(f.start-1,f.end).toString('ascii');values.push(value);if(['int','numeric','decimal'].includes(f.kind)&&value.trim()&&!/^[+-]?\d+(?:\.\d+)?$/.test(value.trim()))reason='numeric';}
 return {values,reason};
}
function keyValues(values:string[],fields:Field[]){
 const trimmed=(name:string)=>(values[fields.findIndex(f=>f.name===name)]??'').trim();return {trimmed,keys:{property:trimmed('prop_id'),year:trimmed('prop_val_yr'),supplement:trimmed('sup_num'),owner:trimmed('py_owner_id')}};
}
function rowReason(keys:{property:string;year:string;supplement:string;owner:string},trimmed:(name:string)=>string,reason:string|null){
 if(keys.year!=='02026'||keys.supplement!=='000000000000')reason='certified_identity';
 if(!keys.property||!keys.owner||!trimmed('geo_id'))reason='missing_key';
 for(const name of ['appraised_val','assessed_val'])if(!positive(trimmed(name)))reason='valuation';return reason;
}
export function propertyRow(raw:Buffer,ordinal:number,fields:Field[]){
 if(raw.length!==9924||!raw.subarray(-2).equals(Buffer.from('\r\n')))return {ordinal,values:[] as string[],keys:{property:'',year:'',supplement:'',owner:''},reason:'row_width'};
 const {values,reason}=fieldValues(raw,fields),{keys,trimmed}=keyValues(values,fields);return {ordinal,values,keys,reason:rowReason(keys,trimmed,reason)};
}

function positive(value:string){return /^\+?\d+(?:\.\d+)?$/.test(value)&&/[1-9]/.test(value);}
async function layoutFields(path:string){
 return withZip(path,LIMITS.layout,async zip=>{
  const members=await inventory(zip),name='Legacy8.0.33-AppraisalExportLayout.pdf';
  if(JSON.stringify(members.map(m=>m.name))!==JSON.stringify([name,'Legacy8.0.33-AppraisalExportLayout.xlsx']))throw new Error('layout member identity');
  const pdf=await readMember(zip,members[0]!,LIMITS.layout);if(!pdf.subarray(0,5).equals(Buffer.from('%PDF-')))throw new Error('layout PDF');
  const text=Bun.spawnSync(['pdftotext','-layout','-','-'],{stdin:pdf,timeout:10000,maxBuffer:2097152});if(text.exitCode!==0)throw new Error('layout PDF parse failed; pdftotext required');return parseLayout(text.stdout.toString());
 });
}
export function selected(selection:string,rows:number){if(selection!==SELECTION)throw new Error('explicit supported selection required');if(rows!==25)throw new Error('first release requires exactly25 Property rows');}
export async function readSelection(archive:string,layout:string,selection:string,rows:number){
 selected(selection,rows);
 if(await digest(archive,LIMITS.compressed)!==ARCHIVE_HASH)throw new Error('retained archive hash identity');
 if(await digest(layout,LIMITS.layout)!==LAYOUT_HASH)throw new Error('retained layout hash identity');
 const fields=await layoutFields(layout);
 return withZip(archive,LIMITS.compressed,async zip=>{
  const members=await inventory(zip);if(members.length!==21)throw new Error('certified member count');const property=members.find(m=>m.name==='PROP.TXT'),header=members.find(m=>m.name==='APPR_HDR.TXT');if(!property||!header)throw new Error('certified members missing');
  const raw=await readMember(zip,property,LIMITS.sample,true),headerRaw=await readMember(zip,header,4096);
  return {fields,raw,header:headerRaw,members:serialized(members),rows:Array.from({length:25},(_,i)=>propertyRow(raw.subarray(i*9924,(i+1)*9924),i+1,fields)),coverage:'partial: first25 PROP.TXT records only; no all-row semantic or current whole-member CRC claim'};
 });
}
