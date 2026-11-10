import {load,type CheerioAPI} from 'cheerio';
import {humanScope} from './human-policy';
export type ArchiveOption={value:string;label:string;selected:boolean};
function formFields($:CheerioAPI,form:ReturnType<CheerioAPI>) {
 const fields=new URLSearchParams();
 form.find('input[name]').each((_,e)=>{
  const n=$(e),type=(n.attr('type')??'text').toLowerCase();
  if(['hidden','text','date'].includes(type)) fields.append(n.attr('name')!,n.attr('value')??'');
 });
 return fields;
}
function requireFilterForm(form:ReturnType<CheerioAPI>,action:string,page:string):void {
 const valid=[form.length>0,humanScope(action),new URL(action).pathname===new URL(page).pathname,(form.attr('method')??'get').toLowerCase()==='post'];
 if(!valid.every(Boolean)) throw Error('unsafe archive filter form');
}
export function archiveForm(html:string,page:string,value?:string) {
 const $=load(html),select=$('select[name]').filter((_,e)=>$(e).find('option').toArray().some(o=>/\b\d{4}-\d{2}-\d{2}\b/.test($(o).text()))).first();
 if(!select.length) throw Error('published archive selector missing');
 const form=select.closest('form'),name=select.attr('name')!,action=new URL(form.attr('action')||page,page).href;
 requireFilterForm(form,action,page);
 const options:ArchiveOption[]=select.find('option').toArray().map(e=>({value:$(e).attr('value')??'',label:$(e).text(),selected:$(e).attr('selected')!==undefined}));
 const fields=formFields($,form);
 if(value!==undefined) {
  if(!options.some(o=>o.value===value)) throw Error('archive value not published');
  fields.set(name,value);
 }
 return {name,action,options,body:fields.toString()};
}
export function requireArchiveEndpoint(sourceHref:string,endpoint:string):void {
 const raw=new URL(sourceHref),chosen=new URL(endpoint);
 const valid=[humanScope(endpoint),['http:','https:'].includes(raw.protocol),raw.hostname==='online.encodeplus.com',!raw.username,!raw.password,!raw.port,raw.pathname==='/regs/traviscounty-tx/archivedialog.aspx',chosen.pathname===raw.pathname,chosen.search===raw.search];
 if(!valid.every(Boolean)) throw Error('unsafe archive source identity');
}
export function sourceLinks(html:string,page:string) {
 const $=load(html);
 return $('a[href]').toArray().map(e=>({href:$(e).attr('href')!,label:$(e).text(),url:new URL($(e).attr('href')!,page).href})).filter(e=>humanScope(e.url));
}
export function historicalPdfLink(html:string,page:string,chapter:string) {
 if(!/^\d+$/.test(chapter)) throw Error('unsafe historical chapter identity');
 const matches=sourceLinks(html,page).filter(e=>/\/doclibrary\.aspx$/i.test(new URL(e.url).pathname) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(new URL(e.url).searchParams.get('id')??'') && new RegExp('\\bCh(?:apter)?[ ._-]*'+chapter+'\\b','i').test(e.label));
 if(matches.length!==1) throw Error('historical chapter link missing or ambiguous');
 return matches[0]!;
}
