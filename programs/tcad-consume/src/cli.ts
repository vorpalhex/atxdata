import {Store} from './store';import {SELECTION,ARCHIVE_HASH,selected} from './source';import {withZip,inventory,serialized,integrity,digest,LIMITS} from './archive';
const OPTIONS:Record<string,string[]>={list:[],import:['--archive','--layout','--selection','--rows','--output'],inventory:['--archive','--selection'],integrity:['--archive','--selection','--max-expanded','--max-seconds'],status:['--output'],verify:['--output']};
function options(command:string,args:string[]){
 const supported=OPTIONS[command];if(!supported)throw new Error('offline commands: list | inventory | import | status | verify | integrity');const values=new Map<string,string>();
 for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!supported.includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('invalid arguments');values.set(key,value);}
 for(const key of supported)if(!values.has(key))throw new Error(`required ${key}`);return values;
}
async function inspect(command:string,v:Map<string,string>){
 selected(v.get('--selection')!,25);const archive=v.get('--archive')!;if(await digest(archive,LIMITS.compressed)!==ARCHIVE_HASH)throw new Error('retained archive hash identity');
 return withZip(archive,LIMITS.compressed,async zip=>{const members=await inventory(zip);if(command==='inventory')return {members:serialized(members),coverage:'metadata only; CRC/row quality not established',httpRequests:0};return {...await integrity(zip,members,Number(v.get('--max-expanded')),Number(v.get('--max-seconds'))),httpRequests:0};});
}
export async function run(args:string[]){
 const [command,...rest]=args;if(!command)throw new Error('offline command required');const v=options(command,rest);
 if(command==='list')return {selection:SELECTION,rows:25,network:false,coverage:'partial first25 Property records'};
 if(['inventory','integrity'].includes(command))return inspect(command,v);
 if(command==='import')selected(v.get('--selection')!,Number(v.get('--rows')));
 const store=await Store.open(v.get('--output')!);
 try{if(command==='status')return store.status();if(command==='verify')return await store.verify();return await store.import(v.get('--archive')!,v.get('--layout')!,v.get('--selection')!,Number(v.get('--rows')));}finally{await store.close();}
}
if(import.meta.main)run(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value)),e=>{console.error(String(e));process.exitCode=1;});
