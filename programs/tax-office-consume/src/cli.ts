import {Collector} from './collector';import {collect} from './live';import {CAPS} from './source';
const COMMANDS=['list','import','collect','status','verify'];
function allowed(command:string){
 if(command==='import')return ['--output','--selection','--max-rows','--csv','--layout'];
 if(command==='collect')return ['--output','--selection','--max-rows'];
 return command==='list'?[]:['--output'];
}
function validOption(command:string,key:string,value:string|undefined,values:Map<string,string>){
 if(!allowed(command).includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('invalid arguments');
}
function options(command:string,args:string[]){
 const values=new Map<string,string>();let refresh=false;
 for(let i=0;i<args.length;i++){
  const key=args[i]!;
  if(key==='--refresh'&&['collect','import'].includes(command)&&!refresh){refresh=true;continue;}
  validOption(command,key,args[i+1],values);
  values.set(key,args[++i]!);
 }
 for(const key of allowed(command))if(!values.has(key))throw new Error(`required ${key}`);
 return {values,refresh};
}
function selection(command:string,values:Map<string,string>){
 if(!['import','collect'].includes(command))return 0;
 const raw=values.get('--max-rows')!,maxRows=Number(raw);
 if(!/^\d+$/.test(raw)||maxRows<1||maxRows>CAPS.rows||values.get('--selection')!=='delinquency')throw new Error('explicit delinquency and row ceiling required');return maxRows;
}
async function dispatch(c:Collector,command:string,values:Map<string,string>,maxRows:number,refresh:boolean){
 if(command==='status')return c.status();if(command==='verify')return c.verify();
 if(command==='import')return c.importRetained(values.get('--selection')!,{csv:values.get('--csv')!,layout:values.get('--layout')!,maxRows,refresh});
 return collect(c,values.get('--selection')!,maxRows,refresh);
}
export async function run(args:string[]){
 const [command,...rest]=args;if(!COMMANDS.includes(command!))throw new Error('commands: list | import | collect | status | verify');
 const {values,refresh}=options(command!,rest),maxRows=selection(command!,values);
 if(command==='list')return [{selection:'delinquency',csvBytes:CAPS.csv,layoutBytes:CAPS.layout,history:false}];
 const c=await Collector.open(values.get('--output')!);try{return await dispatch(c,command!,values,maxRows,refresh);}finally{await c.close();}
}
if(import.meta.main)run(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result)),e=>{console.error(String(e));process.exitCode=1;});
