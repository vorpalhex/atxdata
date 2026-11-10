import { parseArgs } from 'node:util';
import { version } from '../package.json';
export const sourceCommands=['discover','collect','acquire','sync','verify-source'];
const commands=['import','status','verify',...sourceCommands];
const strings=['file','output','source-archive','fiscal-year','first-year','last-year','max-requests','max-bytes','max-total-bytes','max-rows'];
const options={...Object.fromEntries(strings.map(name=>[name,{type:'string' as const}])),refresh:{type:'boolean' as const},help:{type:'boolean' as const,short:'h'},version:{type:'boolean' as const}};
function inspect(args:string[]){
 const parsed=parseArgs({args,options,allowPositionals:true,strict:false,tokens:true});
 const boundary=parsed.tokens.find(t=>t.kind==='option-terminator')?.index??Infinity;
 const words=parsed.tokens.flatMap(t=>t.kind==='positional' && t.index<boundary?[t.value]:[]);
 return {values:parsed.values,words};
}
export function commandOf(args:string[]){return inspect(args).words[0];}
export function information(args:string[]):string|undefined {
 const {values,words}=inspect(args);
 if(values.version===true)return `financial-transparency-consume ${version}`;
 if(values.help!==true && words[0]!=='help')return;
 const command=words[0]==='help'?words[1]:words[0];
 if(command && !commands.includes(command))throw new Error('usage');
 return help(command);
}
export function help(command?:string){return `Fiscal-year CSV importer and acquisition companion${command?`: ${command}`:''}.\nUsage: bun src/cli.ts ${command??commands.join('|')} [options]\nimport --file CSV --fiscal-year YEAR --output PRIVATE_ARCHIVE [--max-bytes N] [--max-rows N]\nverify/status --output PRIVATE_ARCHIVE\ndiscover --source-archive PRIVATE_SOURCE (--fiscal-year YEAR | --first-year YEAR --last-year YEAR) [budgets] [--refresh]\ncollect/acquire/sync --source-archive PRIVATE_SOURCE --output PRIVATE_IMPORT --fiscal-year YEAR [budgets] [--refresh]\nverify-source --source-archive PRIVATE_SOURCE --output PRIVATE_IMPORT\nBudgets: --max-requests 10, --max-bytes 104857600, --max-total-bytes 209715200, --max-rows 1000000. Positive safe decimal integers, no leading zeroes.\nExamples:\n  bun src/cli.ts import --file "$CSV" --fiscal-year 2032 --output "$ARCHIVE"\n  bun src/cli.ts discover --source-archive "$SOURCE" --fiscal-year 2032\nUse private canonical directories outside checkouts. Source archive and import output are separate. Browser download is separate optional input. seed is unsupported.\nOptions accept equals/split values before/after commands, within documented command scopes; duplicate options fail. -- ends options; subsequent operands are not command/help selectors.\n-h, --help, help COMMAND, --version are offline. Plain invocation retains fixed failure/status 1 with guidance.\nImport/reuse exits 0 clean, 2 partial; collect also 3 unavailable, 4 unsupported. Verify/status/source verification 0 success, 1 failure. Results are JSON, failures stay {"error":"operation_failed"}. No census/history completeness claim.\nDiscovery is caller-bounded HEAD candidates, not content validation. Default verified reuse and verify-source make zero HTTP requests. Refresh requests a new snapshot. Retries=0; redirects=0; spacing>=3 seconds plus stricter policy/cooldown. No prompts, color or pager.\n`;}
export function guidance(diagnose:(text:string)=>void=console.error){diagnose('financial-transparency-consume: operation failed. Check command, required options, positive decimal limits and private archive permissions; use --help or help COMMAND. No private error details are printed.');}
