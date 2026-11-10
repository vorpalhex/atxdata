import {write} from 'node:fs';
import metadata from '../package.json';

type Command = {usage:string; description:string; options:string[]; flags?:string[]; notes?:string};
export type Commands = Record<string,Command>;
const name=metadata.name;
export function tokenLabel(token:string){return /^-{0,2}[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(token)?JSON.stringify(token):'[invalid token; consult help]';}
export function usage(command?:string){return `Usage: ${name} ${command??'COMMAND'} [OPTIONS]\nTry '${name} ${command?'help '+command:'--help'}' for options and examples.`;}
function commandSpec(commands:Commands,command?:string){return command&&Object.hasOwn(commands,command)?commands[command]:undefined;}
function helpHeading(commands:Commands,command:string|undefined,spec:Command|undefined){
 return spec?`${name}: ${spec.description}\nUsage: ${name} ${command}${spec.usage?' '+spec.usage:''}`:`${name}: Inspect and retain bounded TCAD selections\nUsage: ${name} COMMAND [OPTIONS]\n\nCommands:\n${Object.entries(commands).map(([key,s])=>`  ${key.padEnd(19)} ${s.description}`).join('\n')}`;
}
function helpOptions(spec:Command|undefined){
 return spec?`\n\nOptions (command-local):\n${spec.options.map(k=>`  ${k}${spec.flags?.includes(k)?'':' VALUE'}`).join('\n')}`:'';
}
export function help(commands:Commands,examples:string,command?:string){
 const spec=commandSpec(commands,command);
 if(command&&!spec)throw new Error(`unknown help command ${tokenLabel(command)}; try --help`);
 const heading=helpHeading(commands,command,spec);
 const options=helpOptions(spec);
 return heading+options+(spec?.notes?'\n\n'+spec.notes:'')+`\n\n  -h, --help       Show this help without opening state\n  help COMMAND     Show command-local help\n  --version        Program version (top-level only)\n\nExamples (operator-supplied canonical paths):\n${examples}\n\nOptions follow the command; --key=value and --key value are equivalent.\nRepeated options and abbreviations are rejected. -- ends options; no file operands are accepted.\nResults are one JSON document plus newline on stdout; errors go to stderr (status 1).\nInputs are retained canonical regular files; --output is a private archive root, not stdout.\nSee this program's README for bounds, retained inputs, safety and recovery.\n`;
}
function topInformation(command:string|undefined,rest:string[],commands:Commands,examples:string){
 if(command==='--version')return `${name} ${metadata.version}\n`;
 if(command==='--help'||command==='-h')return help(commands,examples);
 if(command==='help'){
  if(rest.length>1)throw new Error('help accepts one command; try --help');
  return help(commands,examples,rest[0]);
 }
}
// Walk only option positions; required values may themselves spell --help.
function commandHelpRequested(rest:string[],spec:Command){
 for(let i=0;i<rest.length;i++){
  const token=rest[i]!;if(token==='--')break;
  if(token==='--help'||token==='-h')return true;
  if(!token.includes('=')&&spec.options.includes(token)&&!spec.flags?.includes(token))i++;
 }
 return false;
}
export function information(args:string[],commands:Commands,examples:string){
 const [command,...rest]=args;
 const top=topInformation(command,rest,commands,examples);if(top!==undefined)return top;
 const spec=commandSpec(commands,command);if(!spec)return;
 if(commandHelpRequested(rest,spec))return help(commands,examples,command);
}
function optionKey(token:string,allowed:string[],values:Map<string,string>){
  if(!token.startsWith('-'))throw new Error('unexpected operand; this command accepts named options only');
  const split=token.indexOf('='),key=split<0?token:token.slice(0,split);
  if(!allowed.includes(key))throw new Error(`unknown option ${tokenLabel(key)}; use the exact name shown in help`);
  if(values.has(key))throw new Error(`repeated option ${key}; supply it once`);
 return {key,split};
}
function optionValue(args:string[],i:number,token:string,key:string,split:number,flag:boolean){
  if(flag){
   if(split>=0)throw new Error(`${key} is a bare flag; omit it for false`);
   return {value:'true',next:i};
  }
  const value=split<0?args[++i]:token.slice(split+1);
  if(!value||(split<0&&value.startsWith('--')))throw new Error(`${key} requires a nonempty value; use ${key}=VALUE or ${key} VALUE`);
  return {value,next:i};
}
export function parseOptions(args:string[],allowed:string[],required:string[],flags:string[]=[]){
 const values=new Map<string,string>();
 for(let i=0;i<args.length;i++){
  const token=args[i]!;
  if(token==='--'){
   if(i+1<args.length)throw new Error('unexpected operand after --; this command accepts named options only');
   break;
  }
  const {key,split}=optionKey(token,allowed,values);
  const {value,next}=optionValue(args,i,token,key,split,flags.includes(key));
  values.set(key,value);i=next;
 }
 for(const key of required)if(!values.has(key))throw new Error(`required ${key}; see command help`);
 return values;
}

// Asynchronous descriptor writes keep the event loop free even for a blocking pipe.
// One monotonic deadline covers all partial writes/retries, not each chunk.
type Writer={write:typeof write;now:()=>number};
function stdoutTimeout(){return Object.assign(new Error('stdout deadline'),{code:'ETIMEDOUT',outputPending:true});}
async function writeAttempt(writer:Writer,data:Buffer,offset:number,expired:Promise<never>){
 try{
  return await Promise.race([new Promise<number>((resolve,reject)=>{
   writer.write(1,data,offset,Math.min(16384,data.length-offset),(error,written)=>error?reject(error):resolve(written));
  }),expired]);
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='EAGAIN')throw error;
  await Promise.race([new Promise(r=>setTimeout(r,1)),expired]);
 }
}
function outputFailure(cause:unknown){
 const code=(cause as NodeJS.ErrnoException).code;
 return Object.assign(new Error(`stdout delivery failed${code?' ('+code+')':''}; completed archive work is retained`),
  {code,outputFailure:true,outputPending:(cause as {outputPending?:boolean}).outputPending===true});
}
export async function writeOutput(text:string,writer:Writer={write,now:()=>performance.now()}){
 const deadline=writer.now()+10000,data=Buffer.from(text);let offset=0;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(stdoutTimeout()),Math.max(0,deadline-writer.now()));});
 try{
  while(offset<data.length){
   if(writer.now()>=deadline)throw stdoutTimeout();
   const written=await writeAttempt(writer,data,offset,expired);
   if(written===undefined)continue;
   if(writer.now()>=deadline)throw stdoutTimeout();
   if(written===0)throw new Error('stdout made no write progress');
   offset+=written;
  }
 }catch(cause){throw outputFailure(cause);}finally{clearTimeout(timer);}
}
// A timed-out OS write cannot be canceled portably. Domain work is already closed;
// terminate the native process rather than waiting forever for its writer thread.
export function nativeFailure(error:unknown){
 failure(error);
 if((error as {outputPending?:boolean})?.outputPending===true)process.exit(1);
}
export function failure(error:unknown){

 console.error(`${name}: ${error instanceof Error?error.message:String(error)}\n${usage()}`);process.exitCode=1;
}
