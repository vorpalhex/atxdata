import {fileURLToPath} from 'node:url';import {withZip,inventory,readMember,LIMITS} from './archive';import type {Field} from './source';
export type LayoutSchema={member:string;sheet:string;format:'tab'|'fixed';fields:Field[];width:number;error?:string};
export async function loadSchemas(path:string):Promise<LayoutSchema[]>{
 return withZip(path,LIMITS.layout,async zip=>{
 const members=await inventory(zip),xlsx=members.filter(m=>m.name.toLowerCase().endsWith('.xlsx'));if(xlsx.length!==1)throw new Error('select layout ZIP with one workbook');
 const raw=await readMember(zip,xlsx[0]!,LIMITS.layout);
 const p=Bun.spawnSync(['python3',fileURLToPath(new URL('./layouts.py',import.meta.url))],{stdin:raw,timeout:10000,maxBuffer:4*1024**2});if(p.exitCode!==0)throw new Error('layout workbook parse failed');
 const schemas=JSON.parse(p.stdout.toString()) as LayoutSchema[];
 for(const s of schemas){let next=1;if(s.format==='fixed')for(const f of s.fields){if(f.start!==next||f.end-f.start+1!==f.length)s.error='noncontiguous layout';next=f.end+1;}}
 return schemas;
 });
}
function recordBody(raw:Buffer){const tail=raw.subarray(-2).equals(Buffer.from('\r\n'))?2:raw.at(-1)===10?1:0;return raw.subarray(0,raw.length-tail);}
function numericInvalid(f:Field,value:string){return /^(int|numeric|decimal)/i.test(f.kind)&&!!value.trim()&&!/^[+-]?\d+(?:\.\d+)?$/.test(value.trim());}
function rowReason(body:Buffer,values:string[],s:LayoutSchema){
 if((s.format==='fixed'&&body.length!==s.width)||(s.format==='tab'&&values.length!==s.fields.length))return 'row_width';
 if(body.some(b=>b>127))return 'non_ascii';
 if(s.fields.some((f,i)=>numericInvalid(f,values[i]!)))return 'numeric';return null;
}
export function decodeRow(raw:Buffer,s?:LayoutSchema){
 if(!s)return {values:null,reason:null,interpreted:false};
 const body=recordBody(raw);
 if(s.error)return {values:null,reason:s.error,interpreted:false};
 const values=s.format==='tab'?body.toString('latin1').split('\t'):s.fields.map(f=>body.subarray(f.start-1,f.end).toString('latin1'));
 return {values,reason:rowReason(body,values,s),interpreted:true};
}
