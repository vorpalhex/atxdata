import {test,expect} from 'bun:test';
import {archiveForm,historicalPdfLink} from '../src/historical';
const page='https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx';
test('published arbitrary archive values, server selected aliases and form state are not chapter identifiers',()=>{
 const html='<form method="post"><input name="effectiveDate" value=""><select name="ordinance"><option value="unexpected-77" selected>2001-02-03 Item 7 Ch619</option><option value="unexpected-77" selected>2001-02-03 Item 7 Ch37</option></select></form>';
 const parsed=archiveForm(html,page,'unexpected-77');
 expect(parsed.options.map(o=>o.label)).toEqual(['2001-02-03 Item 7 Ch619','2001-02-03 Item 7 Ch37']);
 expect(parsed.body).toBe('effectiveDate=&ordinance=unexpected-77');
 expect(()=>archiveForm(html,page,'13')).toThrow('not published');
 expect(historicalPdfLink('<a href="doclibrary.aspx?id=12345678-1234-4567-89ab-123456789abc">2001-02-03 Item 7 Ch619</a>',page,'619').href).toBe('doclibrary.aspx?id=12345678-1234-4567-89ab-123456789abc');
});

import {Engine} from '../src/engine';
import {Transport} from '../src/transport';
import {sources} from '../src/adapters';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
test('anonymous source-linked archive selection follows only published form and verifies server readback',async()=>{
 const root=await realpath(await mkdtemp(join(process.env.TMPDIR!,'archive-flow-'))),engine=await Engine.open(root);
 const href='http://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx';
 const form=(selected:boolean)=>`<form method="post"><input name="effectiveDate" value=""><select name="ordinance"><option value="unusual-91" ${selected?'selected':''}>2000-01-02 Ch811</option></select></form>`;
 let now=10000;const calls:{url:string;method:string;body:string}[]=[];
 try {
  await engine.importPage('county-code',sources['county-code'].pages[0],`<a href="${href}">Archives</a>`,'authored');
  const transport=new Transport(engine,{now:()=>now,sleep:async(ms)=>{now+=ms;},fetch:async(url,init)=>{calls.push({url,method:init.method??'GET',body:String(init.body??'')});return new Response(url.endsWith('/robots.txt')?'User-agent: *\nDisallow: /regs/':form(calls.length>2),{headers:{'content-type':url.endsWith('/robots.txt')?'text/plain':'text/html','set-cookie':'anonymous=own; Path=/regs/traviscounty-tx/; Secure'}});}},{},{human:true});
  const result=await transport.archive(href,page,'unusual-91');
  expect(result.aliases).toEqual(['2000-01-02 Ch811']);
  expect(calls.map(c=>c.method)).toEqual(['GET','GET','POST','GET']);
  expect(calls[2]!.body).toBe('effectiveDate=&ordinance=unusual-91');
  expect(result.sourceHref).toBe(href);expect(result.endpoint).toBe(page);
 }finally {await engine.close();await rm(root,{recursive:true,force:true});}
});
