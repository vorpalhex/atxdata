import {Collector} from './collector';
import {information,writeOutput,nativeFailure as failure,parseOptions,tokenLabel} from './frontend';
import {commandHelp,EXAMPLES} from './cli-help';
import {collect} from './live';
import {discover,collectExport} from './export-live';
import {CAPS,positive} from './source';
import {retainCatalog,readCatalog,importExport,exportLimits} from './exports';
const BUDGETS=['--max-bytes','--max-rows','--max-requests','--max-total-bytes'];
const OPTIONS:Record<string,string[]>={list:['--output'],import:['--output','--selection','--max-rows','--csv','--layout','--max-bytes'],collect:['--output','--selection',...BUDGETS,'--catalog-version','--version'],status:['--output'],verify:['--output'],discover:['--output',...BUDGETS],'catalog-import':['--output','--html'],'import-export':['--output','--selection','--file','--layout','--catalog-version',...BUDGETS]};
const REQUIRED:Record<string,string[]>={list:[],'catalog-import':['--output','--html'],import:['--output','--selection','--max-rows','--csv','--layout'],'import-export':['--output','--selection','--file'],collect:['--output','--selection']};
function argumentsFor(command:string,args:string[],allowed:string[]){
 const flags=['collect','import'].includes(command)?['--refresh']:[];
 const values=parseOptions(args,[...allowed,...flags],[],flags);
 return {values,refresh:values.get('--refresh')==='true'};
}
function validateBudgets(values:Map<string,string>){
 for(const key of BUDGETS)if(values.has(key)){const raw=values.get(key)!;if(!/^\d+$/.test(raw))throw new Error(key+' ceiling');positive(Number(raw),key);}
}
function validateDelinquency(values:Map<string,string>){
 if(!values.has('--max-rows'))throw new Error('required --max-rows');
 if(values.has('--catalog-version')||values.has('--version'))throw new Error('catalog/version selectors require catalog item selection');
}
function validateSelection(command:string,values:Map<string,string>){
 if(['import','collect'].includes(command)){
  const selected=values.get('--selection')!;if(selected!=='delinquency'&&(command==='import'||!selected.startsWith('/')))throw new Error('explicit supported selection required');
  if(selected==='delinquency')validateDelinquency(values);
 }
}
function options(command:string,args:string[]){
 const allowed=Object.hasOwn(OPTIONS,command)?OPTIONS[command]:undefined;
 if(!allowed)throw new Error(command?`unknown command ${tokenLabel(command)}; try --help`:'command required; try --help');
 const result=argumentsFor(command,args,allowed);
 for(const key of REQUIRED[command]??['--output'])if(!result.values.has(key))throw new Error('required '+key);
 validateBudgets(result.values);validateSelection(command,result.values);
 if(result.refresh&&result.values.has('--version'))throw new Error('retained version selector cannot request refresh');
 return result;
}
function budgets(values:Map<string,string>){
 const out:Record<string,number>={};for(const [option,name] of [['--max-bytes','maxBytes'],['--max-rows','maxRows'],['--max-requests','maxRequests'],['--max-total-bytes','maxTotalBytes']])if(values.has(option!))out[name!]=Number(values.get(option!));return out;
}
async function dispatch(c:Collector,command:string,v:Map<string,string>,refresh:boolean){
 const limits=budgets(v),selection=v.get('--selection')!;
 if(command==='status')return c.status();if(command==='verify')return c.verify();if(command==='list')return {...await readCatalog(c),observations:c.db.query("SELECT selection,version,status,observed_at FROM snapshots WHERE source='tax-office/exports' AND status IN ('complete','reused') ORDER BY rowid").all()};
 if(command==='catalog-import')return c.exclusive(()=>retainCatalog(c,v.get('--html')!));
 if(command==='discover')return discover(c,exportLimits(limits));
 if(command==='import-export')return importExport(c,selection,{file:v.get('--file')!,layout:v.get('--layout'),catalogVersion:v.get('--catalog-version'),limits});
 if(command==='import')return c.importRetained(selection,{csv:v.get('--csv')!,layout:v.get('--layout')!,maxRows:Number(v.get('--max-rows')),maxBytes:limits.maxBytes,refresh});
 return dispatchCollect(c,selection,v,refresh,limits);
}
function dispatchCollect(c:Collector,selection:string,v:Map<string,string>,refresh:boolean,limits:ReturnType<typeof budgets>){
 if(selection!=='delinquency')return collectExport(c,selection,{limits:exportLimits(limits),catalogVersion:v.get('--catalog-version'),version:v.get('--version'),refresh});
 if(v.has('--catalog-version')||v.has('--version'))throw new Error('catalog/version selectors require catalog item selection');
 return collect(c,selection,Number(v.get('--max-rows')),refresh,limits);
}
export async function run(args:string[]){
 const [command,...rest]=args,{values,refresh}=options(command??'',rest);
 if(command==='list'&&!values.has('--output'))return [{selection:'delinquency',csvBytes:CAPS.csv,layoutBytes:CAPS.layout,history:false}];
 const c=await Collector.open(values.get('--output')!);try{return await dispatch(c,command!,values,refresh);}finally{await c.close();}
}
const HELP=commandHelp(Object.fromEntries(Object.entries(OPTIONS).map(([k,v])=>[k,['collect','import'].includes(k)?[...v,'--refresh']:v])));
async function main(args:string[]){
 const text=information(args,HELP,EXAMPLES);
 await writeOutput(text??JSON.stringify(await run(args))+'\n');
}
if(import.meta.main)main(process.argv.slice(2)).catch(failure);
