import {test,expect} from 'bun:test';import {join} from 'node:path';import {rm} from 'node:fs/promises';import {Collector} from '../src/collector';import {collect} from '../src/live';import {ROUTES,HOST} from '../src/source';import {sample,pdf,temp} from './collector.test';
test('documented robots 302 follows only official missing-page Location in a separately paced bounded request',async()=>{
 const base=await temp();let now=10000,end=0;const calls:string[]=[];const c=await Collector.open(join(base,'archive'),{now:()=>now,sleep:async ms=>{now+=ms;},fetch:async(url,init)=>{
 expect(init.redirect).toBe('manual');expect(init.credentials).toBe('omit');expect(now-end).toBeGreaterThanOrEqual(calls.length===2?7000:2000);calls.push(url);end=now;
 if(url===ROUTES.robots)return new Response('redirect',{status:302,headers:{Location:'/404'}});
 if(url===HOST+'/404')return new Response('<html><title>404</title><h2>The page you are looking for doesn\'t seem to exist.</h2></html>',{status:200,headers:{'Retry-After':'7'}});
 if(url===ROUTES.discovery)return new Response('/voterdata/TaxDelqOpenData.csv DelinquentFileLayout.php');return new Response(url===ROUTES.csv?sample():pdf);
 }});
 try{expect((await collect(c,'delinquency',1,true)).rows).toBe(1);expect(calls).toEqual([ROUTES.robots,HOST+'/404',ROUTES.discovery,ROUTES.csv,ROUTES.layout]);expect((await c.verify()).rows).toBe(1);expect(c.db.query('SELECT count(*) n FROM attempts').get()).toEqual({n:5});
 }finally{await c.close();await rm(base,{recursive:true,force:true});}
});
for(const location of ['https://example.invalid/404','http://tax-office.traviscountytx.gov/404','https://user:pass@tax-office.traviscountytx.gov/404','/login','/404?token=x','/404#x'])test('robots refuses unsafe Location '+location.replace('user:pass@','redacted@'),async()=>{
 const base=await temp();let calls=0;const c=await Collector.open(join(base,'archive'),{fetch:async()=>{calls++;return new Response('',{status:302,headers:{Location:location}});}});
 try{await expect(collect(c,'delinquency',1,true)).rejects.toThrow('redirect');expect(calls).toBe(1);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
for(const [status,body] of [[404,'unrelated plain text'],[200,'Not found'],[200,'<html><title>404</title>Page not found</html>'],[404,'<html><title>404</title>Welcome</html>'],[404,'<html><title>Welcome</title>Page not found</html>'],[200,'<html>Welcome</html>'],[404,'<html>Sign in</html>'],[404,'<html>unrelated page</html>'],[200,'<title>404</title>captcha page not found']] as const)test(`robots does not infer absence from arbitrary HTML ${status} ${body}`,async()=>{
 const base=await temp();let calls=0;const c=await Collector.open(join(base,'archive'),{fetch:async()=>{calls++;return new Response(body,{status});}});
 try{await expect(collect(c,'delinquency',1,true)).rejects.toThrow('robots');expect(calls).toBe(1);}finally{await c.close();await rm(base,{recursive:true,force:true});}
});
