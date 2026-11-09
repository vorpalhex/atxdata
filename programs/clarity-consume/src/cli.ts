import { parseArgs } from 'node:util';
import { Collector } from './collector';
import { token,isoDate } from './source';
function options(args:string[]){
  const {values,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:{archive:{type:'string'},election:{type:'string'},date:{type:'string'},refresh:{type:'boolean',default:false}}});
  const command=positionals[0];
  if(positionals.length!==1 || !['list','discover','collect','sync','status','verify'].includes(command) || !values.archive)throw new Error('Usage: bun src/cli.ts list|discover|collect|sync|status|verify --archive ABSOLUTE_PRIVATE_DIRECTORY [--election DIGITS | --date YYYY-MM-DD] [--refresh]');
  validateSelection(command,values);
  return {command,archive:values.archive,election:values.election,date:values.date,refresh:values.refresh};
}
function validateSelection(command:string,values:{election?:string;date?:string;refresh:boolean}){
  const collecting=['collect','sync'].includes(command);
  if(collecting && (values.election!==undefined)===(values.date!==undefined))throw new Error('collect/sync requires exactly one of --election or --date');
  if(values.election!==undefined)token(values.election);
  if(values.date!==undefined)isoDate(values.date);
  if(!collecting && (values.election!==undefined || values.date!==undefined || values.refresh))throw new Error('election/date/refresh only supported by collect/sync');
}
export async function main(args:string[]=process.argv.slice(2)) {
  const input=options(args),collector=await Collector.open(input.archive);
  const collect=()=>input.date!==undefined?collector.collectDate(input.date,input.refresh):collector.collect(input.election!,input.refresh),list=()=>collector.list();
  const commands:Record<string,()=>Promise<unknown>>={collect,sync:collect,list,discover:list,status:()=>collector.status(),verify:()=>collector.verify()};
  try{return await commands[input.command]();}finally{await collector.close();}
}
if(import.meta.main)main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(String(error));process.exitCode=1;});
