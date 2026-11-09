import {readFile} from "node:fs/promises";
import {workBudget,type WorkBudget} from './budgets';
import {statFile} from "../../civicclerk-consume/src/archive";
import {Engine} from "./engine";
import {sourceName,type Selection} from "./adapters";
import {Transport} from "./transport";
import {reviewSelectionHash,type RenderedReview,type PageReview} from "./pdf";

const help=`County document acquisition (private local originals only)
  bun run src/cli.ts COMMAND --root APPROVED_PRIVATE_DIRECTORY [options]
  status|catalog --source SOURCE (catalog requires source; status does not)
  list|verify --source SOURCE --limit N [--year YYYY --chapter TOKEN --date YYYY-MM-DD --role ROLE --url EXACT_URL]
  import-page --source SOURCE --page EXACT_DISCOVERY_URL --input FILE --origin RETAINED_LABEL [--headers FILE]
  import-pdf --observation ID --input FILE --origin RETAINED_LABEL [--headers FILE]
  review-context --observation ID
  review-pdf --observation ID --input FILE (--image PNG | --images PATHS_JSON) --review JSON [--headers FILE]
  archive --source-href EXACT_PUBLISHED_HREF --page EXPLICIT_HTTPS_ENDPOINT [--archive-value VALUE] --allow-network [--human]
  discover --source SOURCE --page EXACT_DISCOVERY_URL --allow-network [--human]
  collect|sync --source SOURCE --limit N [selection options] --allow-network
Sources: county-code, budgets, meeting-archives, election-documents.
Work budgets: --max-requests N (100), --max-bytes N (536870912), --max-pdf-bytes N (134217728), --max-pages N (50). Positive safe integers, per operation, not archive-lifetime quotas. Import and collect share PDF bounds; import/review also honor aggregate body/image byte budgets. Metadata stays3MiB/page and aggregate2000 document occurrences/source.
Discovery follows only actual retained links in relevant source paths; bounded traversal returns complete/pending. catalog reports retained links/selectors and blocked original hrefs, not fabricated routes.
--human is a boolean default-false operator acknowledgement, not identity spoofing. Only the exact enCodePlus Travis County tenant robots disallow can be acknowledged; all other gates remain. archive currently obtains the published selector/catalog or applies its read-only filter with fresh own anonymous state and server-selected readback. It does NOT yet acquire historical PDF bodies.
No redirects/retries/scheduler/server. Global durable >=3second completion pacing, robots, cooldowns, stop gates and history never reset between operations. collect verifies existing selected downloads without HTTP; sync explicitly requests new bytes. Interrupted artifacts/wire fail closed pending manual recovery.
review-pdf accepts explicit reviewed physical pages and image/selection hashes, preserving legacy one-page receipts. Not OCR, interpretation or unattended acceptance. See README for review JSON and source caveats.
`;
type Options=Record<string,string>;
const COMMANDS=["list","verify","status","catalog","import-page","import-pdf","review-pdf","review-context","discover","collect","sync","archive"] as const;
type Command=typeof COMMANDS[number];
const NETWORK=new Set<string>(["discover","collect","sync","archive"]);
function options(args:string[]):Options {
 const parsed:Options={};
 const allowed=new Set(["root","source","limit","year","chapter","date","role","url","page","input","origin","observation","headers","image","images","review","allow-network","human","source-href","archive-value","max-pdf-bytes","max-bytes","max-requests","max-pages"]);
 for(let index=0;index<args.length;index++) {
  const argument=args[index]!,key=argument.replace(/^--/,"");
  if(!argument.startsWith("--") || !allowed.has(key) || Object.hasOwn(parsed,key)) throw new Error("unknown/duplicate option");
  if(key==="allow-network" || key==="human") {parsed[key]="yes";continue;}
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
function budgets(opts:Options):WorkBudget {
 const values:Partial<WorkBudget>={};
 for(const [flag,key] of [['max-pdf-bytes','maxPdfBytes'],['max-bytes','maxBytes'],['max-requests','maxRequests'],['max-pages','maxPages']] as const) {
  if(opts[flag]===undefined) continue;
  if(!/^\d+$/.test(opts[flag]!)) throw Error(`invalid ${flag} budget`);
  values[key]=Number(opts[flag]);
 }
 return workBudget(values);
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
 return engine.importPage(sourceName(required(opts,"source")),required(opts,"page"),(await input(opts,"input",Math.min(3*1024*1024,budgets(opts).maxBytes))).toString(),required(opts,"origin"),await headers(opts));
}
async function importPdf(engine:Engine,opts:Options) {
 return engine.importPdf(required(opts,"observation"),await input(opts,"input",Math.min(engine.maxPdfBytes,budgets(opts).maxBytes)),"application/pdf",required(opts,"origin"),await headers(opts));
}
async function reviewPdf(engine:Engine,opts:Options) {
 const review=JSON.parse((await input(opts,"review",65536)).toString()) as RenderedReview|PageReview;
 const bytes=await input(opts,'input',Math.min(engine.maxPdfBytes,budgets(opts).maxBytes));
 let remaining=budgets(opts).maxBytes-bytes.length;
 if('pages' in review) {
  if(opts.image) throw Error('use images, not image, for page review');
  const paths:unknown=JSON.parse((await input(opts,'images',65536)).toString());
  if(!Array.isArray(paths) || paths.length!==review.pages.length || paths.some(path=>typeof path!=='string')) throw Error('invalid reviewed image paths');
  const images=[];
  for(const path of paths) {const image=await input({input:path},'input',Math.min(remaining,5*1024*1024));images.push(image);remaining-=image.length;}
  return engine.acceptRenderedPages(required(opts,'observation'),bytes,images,review,await headers(opts));
 }
 return engine.acceptRendered(required(opts,"observation"),bytes,await input(opts,"image",Math.min(remaining,5*1024*1024)),review,await headers(opts));
}
async function collect(engine:Engine,opts:Options,refresh:boolean) {
 const source=sourceName(required(opts,"source")),scope=selection(opts),rows=engine.list(source,scope);
 if(!rows.length) throw new Error("no selected observations");
 const transport=new Transport(engine,{},budgets(opts),{human:opts.human==='yes'}),outcomes=[];
 for(const row of rows) {
  if(!refresh && row.status==="downloaded") outcomes.push(await engine.verify(source,{...scope,url:row.url,limit:1}));
  else outcomes.push(await transport.collect(row.id));
 }
 return outcomes;
}
const ACTIONS:Record<Command,(engine:Engine,opts:Options)=>unknown>={
 archive:(engine,opts)=>new Transport(engine,{},budgets(opts),{human:opts.human==='yes'}).archive(required(opts,'source-href'),required(opts,'page'),opts['archive-value']),
 status:engine=>engine.status(),
 catalog:(engine,opts)=>engine.discoveryCatalog(sourceName(required(opts,'source'))),
 'review-context':(engine,opts)=>{const row=engine.observation(required(opts,'observation'));return {selectionSha256:reviewSelectionHash(row),evidence:row};},
 list:(engine,opts)=>engine.list(sourceName(required(opts,"source")),selection(opts)),
 verify:(engine,opts)=>engine.verify(sourceName(required(opts,"source")),selection(opts)),
 "import-page":importPage,"import-pdf":importPdf,"review-pdf":reviewPdf,
 discover:(engine,opts)=>new Transport(engine,{},budgets(opts),{human:opts.human==='yes'}).discoverTree(sourceName(required(opts,"source")),required(opts,"page")),
 collect:(engine,opts)=>collect(engine,opts,false),
 sync:(engine,opts)=>collect(engine,opts,true),
};
export async function run(args:string[]):Promise<unknown> {
 const command=args[0];
 if(!command || command==="help" || command==="--help") return help;
 if(!(COMMANDS as readonly string[]).includes(command)) throw new Error("unknown command");
 const opts=options(args.slice(1));
 if(NETWORK.has(command) && opts["allow-network"]!=="yes") throw new Error("network requires --allow-network");
 const budget=budgets(opts);
 const engine=await Engine.open(required(opts,"root"),{maxPdfBytes:budget.maxPdfBytes});
 try {return await ACTIONS[command as Command](engine,opts);}
 finally {await engine.close();}
}
if(import.meta.main) run(Bun.argv.slice(2)).then(result=>console.log(typeof result==="string"?result:JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
