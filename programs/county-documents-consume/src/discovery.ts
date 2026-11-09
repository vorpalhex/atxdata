import {load} from 'cheerio';
import {officialUrl,sources,type Source} from './adapters';
export type PageLink={url:string;href:string;label:string};
const PREFIX:Record<Source,string[]>={budgets:['/planning-budget'],'county-code':['/commissioners-court/county-code','/regs/traviscounty-tx/'],'meeting-archives':['/departments/commissioners-court/cc-archives'],'election-documents':['/current-election-information/','/election-results','/elections/','/past-election']};
const RELEVANT:Record<Source,RegExp>={budgets:/budget|fiscal|fy[\s-]*\d|annual|archive|adopted|taxpayer|tax.rate|financial|polic|summary|volume|next|previous|page\s*\d|\b\d{4}\b/i,'county-code':/code|archive|title|chapter|ordinance|next|previous|page\s*\d/i,'meeting-archives':/minutes|archive|\b\d{4}\b|next|previous|page\s*\d/i,'election-documents':/results|reconcil|certif|audit|precinct|archive|past|histor|next|previous|page\s*\d/i};
/** Narrow source paths AND actual retained link required. Never a general same-host crawler. */
export function pageUrl(source:Source,raw:string,base:string):string {
 const value=officialUrl(source,raw,base),url=new URL(value);
 if(!PREFIX[source].some(prefix=>url.pathname===prefix || url.pathname.startsWith(prefix.endsWith('/')?prefix:prefix+'/'))) throw Error('not a source-linked discovery path');
 if(/\.(?:pdf|zip|png|jpg|csv|xml)(?:$)/i.test(url.pathname)) throw Error('not a discovery page');
 if(/(?:logout|login|register|search|about|autotabs|doc-viewer|contact|staff|public-information|records-request|election-worker)\b/i.test(url.pathname)) throw Error('not a read-only discovery route');
 url.hash='';
 return url.href;
}
export function pageLinks(source:Source,page:string,html:string):PageLink[] {
 const $=load(html),links=new Map<string,PageLink>();
 $('a[href]').each((_,element)=>{
  const node=$(element);if(node.parents('footer,nav,header').length) return;
  const href=node.attr('href')!;
  if(href.startsWith('#')) return;
  try {
   const url=pageUrl(source,href,page);
   if(!RELEVANT[source].test(node.text()+' '+new URL(url).pathname.split('/').filter(Boolean).at(-1))) return;
   if(url===page) return;
   links.set(url,{url,href,label:node.text()});
   if(links.size>2000) throw Error('discovery link ceiling');
  }catch(error){if(String(error).includes('ceiling')) throw error;}
 });
 return [...links.values()];
}
export function rootPage(source:Source,url:string):boolean {return (sources[source].pages as readonly string[]).includes(url);}
/** Preserve UI selectors as evidence, not invented network endpoints or adopted dates. */
export function catalog(source:Source,page:string,html:string) {
 const $=load(html),selectors:{id:string|null;name:string|null;value:string;label:string}[]=[],blockedLinks:{href:string;label:string;reason:string}[]=[];
 $('select option').each((_,element)=>{
  const node=$(element),parent=node.parent('select'),label=node.text();
  if(label.trim()) selectors.push({id:parent.attr('id')??null,name:parent.attr('name')??null,value:node.attr('value')??'',label});
 });
 $('a[href]').each((_,element)=>{
  const node=$(element),href=node.attr('href')!,label=node.text();
  if(!/archive|code|title\s*30|budget|election|results|minutes/i.test(label) || node.parents('footer,nav,header').length) return;
  try {officialUrl(source,href,page);}
  catch(error){blockedLinks.push({href,label,reason:String(error)});}
 });
 return {pages:pageLinks(source,page,html),selectors,blockedLinks};
}
