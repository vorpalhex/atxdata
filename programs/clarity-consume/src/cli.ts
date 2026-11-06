import { parseArgs } from 'node:util';
import { Collector } from './collector';
function options(args:string[]){
  const {values,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:{archive:{type:'string'},election:{type:'string'},refresh:{type:'boolean',default:false}}});
  const command=positionals[0];
  if(positionals.length!==1 || !['list','discover','collect','sync','status','verify'].includes(command) || !values.archive)throw new Error('Usage: bun src/cli.ts list|discover|collect|sync|status|verify --archive ABSOLUTE_PRIVATE_DIRECTORY [--election 125662] [--refresh]');
  validateSelection(command,values);
  return {command,archive:values.archive,election:values.election,refresh:values.refresh};
}
function validateSelection(command:string,values:{election?:string;refresh:boolean}){
  const collecting=['collect','sync'].includes(command);
  if(collecting && values.election!=='125662')throw new Error('collect/sync requires --election 125662; this is the only supported selected election');
  if(!collecting && (values.election || values.refresh))throw new Error('election/refresh only supported by collect/sync');
}
export async function main(args:string[]=process.argv.slice(2)) {
  const input=options(args),collector=await Collector.open(input.archive);
  const collect=()=>collector.collect(input.election!,input.refresh),list=()=>collector.list();
  const commands:Record<string,()=>Promise<unknown>>={collect,sync:collect,list,discover:list,status:()=>collector.status(),verify:()=>collector.verify()};
  try{return await commands[input.command]();}finally{await collector.close();}
}
if(import.meta.main)main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(String(error));process.exitCode=1;});
