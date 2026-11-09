import {readFile} from "node:fs/promises";
import {statFile} from "../../civicclerk-consume/src/archive";
import {Engine} from "./engine";
import {sourceName,type Selection} from "./adapters";
import {Transport} from "./transport";
import type {RenderedReview} from "./pdf";

const help=`County document acquisition (private local originals only)
  bun run src/cli.ts COMMAND --root APPROVED_PRIVATE_DIRECTORY [options]
  status
  list|verify --source SOURCE --limit N [--year YYYY --chapter TOKEN --date YYYY-MM-DD --role ROLE --url EXACT_URL]
  import-page --source SOURCE --page EXACT_DISCOVERY_URL --input FILE --origin RETAINED_LABEL [--headers FILE]
  import-pdf --observation ID --input FILE --origin RETAINED_LABEL [--headers FILE]
  review-pdf --observation ID --input FILE --image PNG --review JSON [--headers FILE]
  discover --source SOURCE --page EXACT_DISCOVERY_URL --allow-network
  collect|sync --source SOURCE --limit N [selection options] --allow-network
Sources: county-code, budgets, meeting-archives, election-documents.
Network caps per trusted archive: 24 attempts INCLUDING prior runs; 20MiB conservative combined wire reservations, 2 PDF attempts/source, 5MiB wire AND decoded/PDF; 3MiB/page, aggregate2000 links/source; reference routes only.
No redirects/retries/scheduler/server. collect verifies existing selected downloads without HTTP; sync explicitly requests new bytes within the SAME persistent limits. Interrupted artifacts/wire fail closed pending manual recovery, not automatic attempt reset.
review-pdf is an explicit one-page visual identity assertion, not OCR, election interpretation or an unattended acceptance service. See README for review JSON fields and source caveats.
`;
type Options=Record<string,string>;
const COMMANDS=["list","verify","status","import-page","import-pdf","review-pdf","discover","collect","sync"] as const;
type Command=typeof COMMANDS[number];
const NETWORK=new Set<string>(["discover","collect","sync"]);
function options(args:string[]):Options {
 const parsed:Options={};
 const allowed=new Set(["root","source","limit","year","chapter","date","role","url","page","input","origin","observation","headers","image","review","allow-network"]);
 for(let index=0;index<args.length;index++) {
  const argument=args[index]!,key=argument.replace(/^--/,"");
  if(!argument.startsWith("--") || !allowed.has(key) || Object.hasOwn(parsed,key)) throw new Error("unknown/duplicate option");
  if(key==="allow-network") {parsed[key]="yes";continue;}
  const value=args[++index];
  if(!value || value.startsWith("--")) throw new Error(`missing --${key}`);
  parsed[key]=value;
 }
 return parsed;
}
function required(opts:Options,name:string):string {
 const value=opts[name];
 if(!value) throw new Error(`required --${name}`);
 return value;
}
function selection(opts:Options):Selection {
 const limit=required(opts,"limit");
 if(!/^\d+$/.test(limit) || Number(limit)<1 || Number(limit)>2000) throw new Error("invalid --limit");
 return {limit:Number(limit),year:opts.year,chapter:opts.chapter,date:opts.date,role:opts.role,url:opts.url};
}
async function input(opts:Options,key:string,limit:number):Promise<Buffer> {
 const path=required(opts,key),stat=await statFile(path);
 if(!stat?.isFile() || stat.size>limit) throw new Error("input missing or exceeds byte limit");
 return readFile(path);
}
async function headers(opts:Options):Promise<string|null> {
 return opts.headers?(await input(opts,"headers",65536)).toString():null;
}
async function importPage(engine:Engine,opts:Options) {
 return engine.importPage(sourceName(required(opts,"source")),required(opts,"page"),(await input(opts,"input",3*1024*1024)).toString(),required(opts,"origin"),await headers(opts));
}
async function importPdf(engine:Engine,opts:Options) {
 return engine.importPdf(required(opts,"observation"),await input(opts,"input",5*1024*1024),"application/pdf",required(opts,"origin"),await headers(opts));
}
async function reviewPdf(engine:Engine,opts:Options) {
 const review=JSON.parse((await input(opts,"review",65536)).toString()) as RenderedReview;
 return engine.acceptRendered(required(opts,"observation"),await input(opts,"input",5*1024*1024),await input(opts,"image",5*1024*1024),review,await headers(opts));
}
async function collect(engine:Engine,opts:Options,refresh:boolean) {
 const source=sourceName(required(opts,"source")),scope=selection(opts),rows=engine.list(source,scope);
 if(!rows.length) throw new Error("no selected observations");
 const transport=new Transport(engine),outcomes=[];
 for(const row of rows) {
  if(!refresh && row.status==="downloaded") outcomes.push(await engine.verify(source,{...scope,url:row.url,limit:1}));
  else outcomes.push(await transport.collect(row.id));
 }
 return outcomes;
}
const ACTIONS:Record<Command,(engine:Engine,opts:Options)=>unknown>={
 status:engine=>engine.status(),
 list:(engine,opts)=>engine.list(sourceName(required(opts,"source")),selection(opts)),
 verify:(engine,opts)=>engine.verify(sourceName(required(opts,"source")),selection(opts)),
 "import-page":importPage,"import-pdf":importPdf,"review-pdf":reviewPdf,
 discover:(engine,opts)=>new Transport(engine).discover(sourceName(required(opts,"source")),required(opts,"page")),
 collect:(engine,opts)=>collect(engine,opts,false),
 sync:(engine,opts)=>collect(engine,opts,true),
};
export async function run(args:string[]):Promise<unknown> {
 const command=args[0];
 if(!command || command==="help" || command==="--help") return help;
 if(!(COMMANDS as readonly string[]).includes(command)) throw new Error("unknown command");
 const opts=options(args.slice(1));
 if(NETWORK.has(command) && opts["allow-network"]!=="yes") throw new Error("network requires --allow-network");
 const engine=await Engine.open(required(opts,"root"));
 try {return await ACTIONS[command as Command](engine,opts);}
 finally {await engine.close();}
}
if(import.meta.main) run(Bun.argv.slice(2)).then(result=>console.log(typeof result==="string"?result:JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
