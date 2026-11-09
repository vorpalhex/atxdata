// Authored test-only preload: translate only this fixture's source URLs to loopback.
import {Collector} from '../src/collector';
const target=new URL(process.env.PRODUCER_FIXTURE_URL??'');
if(target.protocol!=='http:'||target.hostname!=='127.0.0.1')throw new Error('loopback fixture URL required');
const originalOpen=Collector.open;
Collector.open=async(root,deps={})=>{
 let now=Date.now();
 return originalOpen(root,{...deps,now:()=>now,sleep:async ms=>{now+=ms;},random:()=>0,fetch:async(url,init)=>{
  const source=new URL(url);if(source.origin!=='https://tax-office.traviscountytx.gov')throw new Error('unexpected fixture source');
  return Bun.fetch(new URL(source.pathname+source.search,target).href,{...init,decompress:false});
 }});
};
