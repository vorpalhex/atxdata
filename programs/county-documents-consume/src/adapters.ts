import {load} from "cheerio";

export const sources={
    "county-code":{pages:["https://www.traviscountytx.gov/commissioners-court/county-code"],disclaimer:"Current reference-only online code; not the Clerk's official paper record. Historical bodies and Title 30 excluded."},
    budgets:{pages:["https://www.traviscountytx.gov/planning-budget/current-year","https://www.traviscountytx.gov/planning-budget","https://www.traviscountytx.gov/planning-budget/archives"],disclaimer:"Document acquisition only, not structured financial interpretation."},
    "meeting-archives":{pages:["https://countyclerk.traviscountytx.gov/departments/commissioners-court/cc-archives/"],disclaimer:"Historical static minutes only. No CivicClerk IDs or boundary completeness; originals private, no public cache/index."},
    "election-documents":{pages:["https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms/"],disclaimer:"Publication acquisition only, not structured election results, certification or discrepancy analysis."},
} as const;
export type Source=keyof typeof sources;
export type Evidence={
    source:Source;pageUrl:string;href:string;url:string;label:string;headings:string[];
    chapter:string|null;year:string|null;date:string|null;originalDate:string|null;
    role:string;publicationDate:null;state:"official"|"unofficial"|"unknown";
    volume:string|null;language:string|null;jurisdiction:string|null;session:string|null;
    fiscalYear:string|null;taxYear:string|null;administeringCounty:"Travis";
};
export type Selection={limit:number;chapter?:string;year?:string;date?:string;role?:string;url?:string};
export function sourceName(value:string):Source {
    if(!Object.hasOwn(sources,value)) throw new Error("unsupported source");
    return value as Source;
}
export function officialUrl(source:Source,raw:string,base:string):string {
    const url=new URL(raw,base),host=new URL(sources[source].pages[0]).hostname;
    if(url.protocol!=="https:" || url.hostname!==host || url.username || url.password || url.port) throw new Error("not an official HTTPS link");
    return url.href;
}
function baseEvidence(source:Source,pageUrl:string,href:string,label:string,headings:string[]):Evidence {
    return {source,pageUrl,href,url:officialUrl(source,href,pageUrl),label,headings:[...headings],chapter:null,year:null,date:null,originalDate:null,role:"unknown",publicationDate:null,state:"unknown",volume:null,language:null,jurisdiction:null,session:null,fiscalYear:null,taxYear:null,administeringCounty:"Travis"};
}
function chapter(row:Evidence):Evidence|null {
    const match=/^Chapter\s+(\d+)\b/i.exec(row.label);
    if(!match || row.headings.some(heading=>/^Title\s+30\b/i.test(heading))) return null;
    return {...row,chapter:match[1]!,role:"chapter"};
}
const BUDGET_ROLES:[RegExp,string][]=[[/taxpayer[ -]?impact|impact.statement/i,"taxpayer-impact"],[/budget.{0,10}brief/i,"budget-in-brief"],[/tax.rate|tax.information/i,"tax-rate"],[/recommendations?/i,"recommendations"],[/guidelines?/i,"guidelines"],[/rules/i,"rules"],[/preliminary/i,"preliminary"],[/adopted/i,"adopted"]];
function roleFrom(text:string,roles:[RegExp,string][]):string|null {
    return roles.find(([pattern])=>pattern.test(text))?.[1]??null;
}
function fiscalYear(row:Evidence):string|null {
    const heading=/(?:Fiscal\s+Year|FY)\s*(\d{4})/i.exec([...row.headings].reverse().join(" | "));
    return heading?.[1]??/(?:Fiscal\s+Year|FY)\s*(\d{4})/i.exec(row.label)?.[1]??null;
}
function language(label:string):string|null {
    if(/Español|Spanish/i.test(label)) return "Spanish";
    return /English/i.test(label)?"English":null;
}
function budget(row:Evidence):Evidence|null {
    const year=fiscalYear(row);
    if(!year) return null;
    const context=[...row.headings,row.label].join(" | ");
    const role=roleFrom(row.label,BUDGET_ROLES)??roleFrom(context,BUDGET_ROLES)??"other-budget";
    return {...row,year,fiscalYear:year,taxYear:/\bTax\s+Year\s+(\d{4})/i.exec(context)?.[1]??null,role,volume:/\bVolume\s+([IVX]+|\d+)\b/i.exec(row.label)?.[1]??null,language:language(row.label)};
}
export function exactDate(year:string,month:string,day:string):string|null {
    if(!/^\d{4}$/.test(year) || Number(year)<1800) return null;
    const value=`${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`;
    const parsed=new Date(value+"T00:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===value?value:null;
}
function minuteDate(match:RegExpExecArray|null,year:string|null):string|null {
    if(!match || (year && match[3]!==year)) return null;
    return exactDate(match[3]!,match[1]!,match[2]!);
}
function session(label:string,original:string|null):string|null {
    if(original===null) return null;
    return label.slice(label.indexOf(original)+original.length).trim()||null;
}
function minutes(row:Evidence):Evidence|null {
    if(!new URL(row.url).pathname.includes("/commissioners_court/archives/")) return null;
    const year=[...row.headings].reverse().find(heading=>/^\s*\d{4}\s*$/.test(heading))?.trim()??null;
    const match=/(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(row.label);
    const originalDate=match?.[0]??null;
    return {...row,year,date:minuteDate(match,year),originalDate,role:"minutes",session:session(row.label,originalDate)};
}
const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const ELECTION_ROLES:[RegExp,string][]=[[/reconcil/i,"reconciliation"],[/cumulative/i,"cumulative"],[/precinct/i,"precinct"],[/audit/i,"audit"],[/certif/i,"certification"],[/results/i,"results"]];
function electionDate(headings:string[]) {
    const match=new RegExp(`(${MONTHS.join("|")}),?\\s+(\\d{1,2}),?\\s+(\\d{4})`,"i").exec([...headings].reverse().join(" | "));
    if(!match) return {date:null,originalDate:null,year:null};
    const month=MONTHS.findIndex(value=>value.toLowerCase()===match[1]!.toLowerCase())+1;
    return {date:exactDate(match[3]!,String(month),match[2]!),originalDate:match[0],year:match[3]!};
}
function officialState(context:string):Evidence["state"] {
    if(/unofficial/i.test(context)) return "unofficial";
    return /\bofficial\b/i.test(context)?"official":"unknown";
}
function election(row:Evidence):Evidence|null {
    const role=roleFrom(row.label,ELECTION_ROLES);
    if(!role) return null;
    const context=[...row.headings,row.label].join(" | ");
    const jurisdiction=/\bCity of ([^|]+?)(?: Election|$)/i.exec(context)?.[0]?.replace(/ Election$/,"")??null;
    return {...row,...electionDate(row.headings),role,state:officialState(context),jurisdiction};
}
const adapters:Record<Source,(row:Evidence)=>Evidence|null>={"county-code":chapter,budgets:budget,"meeting-archives":minutes,"election-documents":election};
type Candidate={href:string;label:string;headings:string[]};
function pageCandidates(html:string):Candidate[] {
    const $=load(html),headings:string[]=[],rows:Candidate[]=[];
    let links=0;
    $("h1,h2,h3,h4,h5,h6,strong,b,a").each((_,element)=>{
        const node=$(element),text=node.text();
        if(node.parents("footer,nav,header").length) return;
        if(element.tagName!=="a") {
            if(node.parents("a").length) return;
            recordHeading(element.tagName,text,headings);
            return;
        }
        const href=node.attr("href");
        if(!href || !/\.pdf(?:[?#]|$)/i.test(href)) return;
        if(++links>2000) throw new Error("link ceiling");
        const local=node.closest(".sow-accordion-panel,.accordion-group").find(".sow-accordion-title,.accordion-heading").first().text();
        rows.push({href,label:text,headings:local?[...headings,local]:[...headings]});
    });
    return rows;
}
function recordHeading(tag:string,text:string,headings:string[]):void {
    if(/^h[1-6]$/.test(tag)) headings.splice(Number(tag[1])-1);
    if(text.trim()) headings.push(text);
}
function parseCandidate(source:Source,pageUrl:string,candidate:Candidate):Evidence|null {
    let row:Evidence;
    try {row=baseEvidence(source,pageUrl,candidate.href,candidate.label,candidate.headings);}
    catch {return null;}
    return adapters[source](row);
}
export function discover(source:Source,pageUrl:string,html:string):Evidence[] {
    if(!(sources[source].pages as readonly string[]).includes(pageUrl)) throw new Error("unapproved discovery page");
    if(Buffer.byteLength(html)>3*1024*1024) throw new Error("metadata byte limit");
    return pageCandidates(html).map(candidate=>parseCandidate(source,pageUrl,candidate)).filter((row):row is Evidence=>row!==null);
}
export function select(rows:Evidence[],selection:Selection):Evidence[] {
    if(!Number.isSafeInteger(selection.limit) || selection.limit<1 || selection.limit>2000) throw new Error("invalid selection limit");
    const filtered=rows.filter(row=>(["chapter","year","date","role","url"] as const).every(key=>selection[key]===undefined || row[key]===selection[key]));
    const unique=new Map<string,Evidence>();
    for(const row of filtered) if(!unique.has(row.url)) unique.set(row.url,row);
    return [...unique.values()].slice(0,selection.limit);
}
