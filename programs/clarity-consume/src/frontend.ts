import { parseArgs } from 'node:util';
import { version } from '../package.json';
export const commands=['list','discover','collect','sync','status','verify'];
export const cliOptions={archive:{type:'string' as const},election:{type:'string' as const},date:{type:'string' as const},refresh:{type:'boolean' as const,default:false}};
function informationInput(args:string[]) {
 const {values,tokens}=parseArgs({args,strict:false,allowPositionals:true,tokens:true,options:{...cliOptions,help:{type:'boolean',short:'h'},version:{type:'boolean'}}});
 const boundary=tokens.find(t=>t.kind==='option-terminator')?.index??Infinity;
 const words=tokens.flatMap(t=>t.kind==='positional' && t.index<boundary?[t.value]:[]);
 return {values,words};
}
export function information(args:string[]):string|undefined {
 const {values,words}=informationInput(args);
 if(values.version===true)return `clarity-consume ${version}`;
 if(values.help!==true && words[0]!=='help')return;
 const command=words[0]==='help'?words[1]:words[0];
 if(command && !commands.includes(command))throw new Error('Unknown command; use clarity-consume --help');
 return help(command);
}
export function help(command?:string){
 return `Clarity selected-election collector${command?`: ${command}`:''}\nUsage: bun src/cli.ts ${command??commands.join('|')} --archive ABSOLUTE_PRIVATE_DIRECTORY [options]\n\nlist/discover: bounded catalog and election IDs, not complete history.\ncollect/sync: exactly one --election DIGITS or --date YYYY-MM-DD; optional --refresh.\nstatus/verify: local archive checks, no HTTP.\nIDs are literal strings: leading zeroes are preserved. Archives must be private canonical directories outside checkouts.\nExamples:\n  bun src/cli.ts list --archive "$ARCHIVE"\n  bun src/cli.ts collect --archive "$ARCHIVE" --election 009876\n  bun src/cli.ts collect --archive "$ARCHIVE" --date 2026-11-03\nOptions accept --name=value or --name value, before/after command; repeats use last value.\n-h, --help, help COMMAND and --version need no archive. -- ends options; subsequent operands are not help.\nResults: pretty JSON. Exit 0 success; 1 failure. Plain invocation retains exit 1. No prompts, color or pager.\n`;
}
