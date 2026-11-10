import {writeSync} from 'node:fs';
import metadata from '../package.json';

type Command = {usage:string; description:string; options:string[]; flags?:string[]; notes?:string};
export type Commands = Record<string,Command>;
const name=metadata.name;
export function tokenLabel(token:string){return /^-{0,2}[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(token)?JSON.stringify(token):'[invalid token; consult help]';}
export function usage(command?:string){return `Usage: ${name} ${command??'COMMAND'} [OPTIONS]\nTry '${name} ${command?'help '+command:'--help'}' for options and examples.`;}
export function help(commands:Commands,examples:string,command?:string){
 const spec=command&&Object.hasOwn(commands,command)?commands[command]:undefined;
 if(command&&!spec)throw new Error(`unknown help command ${tokenLabel(command)}; try --help`);
 const heading=spec?`${name}: ${spec.description}\nUsage: ${name} ${command}${spec.usage?' '+spec.usage:''}`:`${name}: Discover and retain Tax Office exports\nUsage: ${name} COMMAND [OPTIONS]\n\nCommands:\n${Object.entries(commands).map(([key,s])=>`  ${key.padEnd(19)} ${s.description}`).join('\n')}`;
 const options=spec?`\n\nOptions (command-local):\n${spec.options.map(k=>`  ${k}${spec.flags?.includes(k)?'':' VALUE'}`).join('\n')}`:'';
 return heading+options+(spec?.notes?'\n\n'+spec.notes:'')+`\n\n  -h, --help       Show this help without opening state\n  help COMMAND     Show command-local help\n  --version        Program version (top-level only)\n\nExamples (operator-supplied canonical paths):\n${examples}\n\nOptions follow the command; --key=value and --key value are equivalent.\nRepeated options and abbreviations are rejected. -- ends options; no file operands are accepted.\nResults are one JSON document plus newline on stdout; errors go to stderr (status 1).\nInputs are retained canonical regular files; --output is a private archive root, not stdout.\nSee this program's README for bounds, retained inputs, safety and recovery.\n`;
}
// Walk option positions, consuming required values even when they spell --help.
// Unknown tokens do not consume a value; recognized help may bypass unrelated errors.
export function information(args:string[],commands:Commands,examples:string){
 const [command,...rest]=args;
 if(command==='--version')return `${name} ${metadata.version}\n`;
 if(command==='--help'||command==='-h')return help(commands,examples);
 if(command==='help'){
  if(rest.length>1)throw new Error('help accepts one command; try --help');
  return help(commands,examples,rest[0]);
 }
 const spec=command&&Object.hasOwn(commands,command)?commands[command]:undefined;if(!spec)return;
 for(let i=0;i<rest.length;i++){
  const token=rest[i]!;if(token==='--')break;
  if(token==='--help'||token==='-h')return help(commands,examples,command);
  if(!token.includes('=')&&spec.options.includes(token)&&!spec.flags?.includes(token))i++;
 }
}

export function parseOptions(args:string[],allowed:string[],required:string[],flags:string[]=[]){
 const values=new Map<string,string>();
 for(let i=0;i<args.length;i++){
  const token=args[i]!;
  if(token==='--'){
   if(i+1<args.length)throw new Error('unexpected operand after --; this command accepts named options only');
   break;
  }
  if(!token.startsWith('-'))throw new Error('unexpected operand; this command accepts named options only');
  const split=token.indexOf('='),key=split<0?token:token.slice(0,split);
  if(!allowed.includes(key))throw new Error(`unknown option ${tokenLabel(key)}; use the exact name shown in help`);
  if(values.has(key))throw new Error(`repeated option ${key}; supply it once`);
  if(flags.includes(key)){
   if(split>=0)throw new Error(`${key} is a bare flag; omit it for false`);
   values.set(key,'true');continue;
  }
  const value=split<0?args[++i]:token.slice(split+1);
  if(!value||(split<0&&value.startsWith('--')))throw new Error(`${key} requires a nonempty value; use ${key}=VALUE or ${key} VALUE`);
  values.set(key,value);
 }
 for(const key of required)if(!values.has(key))throw new Error(`required ${key}; see command help`);
 return values;
}

// Bounded writes preserve partial-write/backpressure handling; no console buffering.
export async function writeOutput(text:string){
 const data=Buffer.from(text),deadline=Date.now()+10000;let offset=0;
 while(offset<data.length){
  try{
   const written=writeSync(1,data,offset,Math.min(16384,data.length-offset));
   if(written===0)throw new Error('stdout made no write progress');offset+=written;
  }catch(e){
   if((e as NodeJS.ErrnoException).code==='EAGAIN'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1));continue;}
   const code=(e as NodeJS.ErrnoException).code;
   const error=new Error(`stdout delivery failed${code?' ('+code+')':''}; completed archive work is retained`);
   Object.assign(error,{code,outputFailure:true});throw error;
  }
 }
}
export function failure(error:unknown){
 if((error as NodeJS.ErrnoException)?.code==='EPIPE'&&(error as {outputFailure?:boolean}).outputFailure===true)return;
 console.error(`${name}: ${error instanceof Error?error.message:String(error)}\n${usage()}`);process.exitCode=1;
}
