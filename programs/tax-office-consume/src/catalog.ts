import {HOST,ROUTES} from './source';
export type Item={id:string;url:string;label:string;format:string;profile:'raw-original';layout:string|null;year:string|null};
function text(s:string){return s.replace(/<[^>]*>/g,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();}
function family(label:string){return /current year.*prior year/i.test(label)?'current':/delinquent/i.test(label)?'delinquency':null;}
function officialURL(href:string){
 let url:URL;try{url=new URL(href,ROUTES.discovery);}catch{return null;}
 if(url.origin!==HOST||url.username||url.password||url.hash||/%(?:2f|5c|00)/i.test(url.pathname))return null;return url;
}
function fileFormat(url:URL,label:string){
 const file=/^\/voterdata\/[^/]+\.(csv|xlsx|zip)$/i.exec(url.pathname);if(file)return file[1]!.toLowerCase();
 const page=/^\/pages\/[^/]+\.(php|pdf|csv|xlsx|zip)$/i.exec(url.pathname);if(page&&/rates?|exemptions?|history|file layout/i.test(label))return page[1]!.toLowerCase();return null;
}
function publishedItem(href:string,label:string):Item|null{
 const url=officialURL(href);if(!url)return null;const format=fileFormat(url,label);if(!format)return null;
 return {id:url.pathname+url.search,url:url.href,label,format,profile:'raw-original',layout:null,year:label.match(/\b(?:19|20)\d{2}\b/)?.[0]??null};
}
function bindLayouts(items:Item[]){
 const layouts=items.filter(i=>/file layout/i.test(i.label));
 for(const item of items){if(!item.id.startsWith('/voterdata/'))continue;const group=family(item.label),matches=layouts.filter(l=>group!==null&&family(l.label)===group);if(matches.length>1)throw new Error('ambiguous dataset layout');item.layout=matches[0]?.url??null;}
}
export function parseCatalog(html:string):Item[]{
 if(/captcha|access denied|sign[ -]?in|log[ -]?in|challenge/i.test(text(html)))throw new Error('catalog access gate');
 const items=new Map<string,Item>();
 for(const match of html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)){
  const item=publishedItem(text(match[2]!),text(match[3]!));if(!item)continue;
  if(items.has(item.id)&&JSON.stringify(items.get(item.id))!==JSON.stringify(item))throw new Error('ambiguous catalog item');items.set(item.id,item);
 }
 if(!items.size)throw new Error('catalog contains no supported published links');const result=[...items.values()];bindLayouts(result);return result.sort((a,b)=>a.id.localeCompare(b.id));
}
