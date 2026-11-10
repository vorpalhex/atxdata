import {test, expect} from "bun:test";
import {mkdtemp} from "node:fs/promises";
import {join} from "node:path";
import {main, parseArgs} from "../src/cli";
import {Adapter} from "../src/adapter";
import {Archive} from "../src/archive";
test("legacy API never interprets a city dashboard as the old voter ZIP",async()=>{
 const root=await mkdtemp(join(process.env.TMPDIR!,"legacy-city-reject-")),f=fixture(),a=await Archive.open(root,f.deps);
 const adapter=new Adapter(a);
 await expect(adapter.execute("water","rules")).rejects.toThrow("general selection engine");
 expect(f.calls).toBe(0);expect(a.store.status().attempts).toBe(0);
 await a.close();
});
import {configs, source, stableItem} from "../src/sources";
test("city item category ordering is not a source revision; actual changes and county legacy remain strict",()=>{
 expect(stableItem({...item,categories:["a","b"]},{...item,categories:["b","a"]},"austin")).toBe(true);
 expect(stableItem({...item,categories:["a"]},{...item,categories:["b"]},"austin")).toBe(false);
 expect(stableItem({...item,categories:["a","b"]},{...item,categories:["b","a"]},"tnr")).toBe(false);
 expect(stableItem(item,{...item,modified:11},"water")).toBe(false);
});
import {terms} from "../src/rules";
import {fixture, id, item, service} from "./support/selection-fixture";
import {sourceService} from "../src/catalog";

test("city collection needs explicit item before archive creation, not a default dashboard/file", async()=>{
  const root=join(process.env.TMPDIR!,"must-not-create-city");
  for(const selected of ["austin","water"]) {
    expect(()=>parseArgs(["collect","--source",selected,"--archive",root,"--terms-sha256","a".repeat(64)])).toThrow("explicit --item");
    expect(()=>parseArgs(["collect","--source",selected,"--item",id,"--archive",root,"--service",service,"--terms-sha256","a".repeat(64)])).toThrow("source service authority/tenant");
  }
});

test("source authorities reject city/county confusion and wrong hosted tenants",()=>{
  expect(()=>sourceService(service,"austin")).toThrow("source service authority/tenant");
  expect(()=>sourceService("https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/Boundaries/FeatureServer","tnr")).toThrow("source service authority/tenant");
  expect(()=>sourceService("https://services1.arcgis.com/OtherTenant/arcgis/rest/services/Outages/FeatureServer","water")).toThrow("source service authority/tenant");
  expect(sourceService("https://maps.austintexas.gov/arcgis/rest/services/Boundaries/MapServer","austin")).toContain("MapServer");
});

const waterMap="b".repeat(32);
test("Water discovers advertised public layers through official dashboard and web map, not central hub or guessed layer", async () => {
  const f=fixture(), original=f.deps.fetch, calls:string[]=[];
  const waterService="https://services1.arcgis.com/PuB3FWUAxkScvfQy/ArcGIS/rest/services/Fixture_Public_Outages/FeatureServer";
  f.deps.fetch=async(url:string)=>{
    calls.push(url); const u=new URL(url);
    if(url==="https://www.austintexas.gov/water/water-leaks") return new Response('Official <a href="https://www.arcgis.com/apps/dashboards/'+configs.water.site+'">Water</a>');
    if(u.pathname.endsWith(configs.water.site)) return Response.json({id:configs.water.site,access:"public",type:"Dashboard",title:"Public Water"});
    if(u.pathname.endsWith(configs.water.site+"/data")) return Response.json({desktopView:{widgets:[{type:"mapWidget",itemId:waterMap}]}});
    if(u.pathname.endsWith(waterMap)) return Response.json({id:waterMap,access:"public",type:"Web Map",title:"Public Water map"});
    if(u.pathname.endsWith(waterMap+"/data")) return Response.json({operationalLayers:[{id:"public-outages",itemId:id,url:waterService+"/7",title:"Public aggregate outages",layerType:"ArcGISFeatureLayer"}]});
    const response=await original(url.replace(waterService,service));
    if(url.endsWith("robots.txt")) return response;
    return new Response((await response.text()).replaceAll(service,waterService),{status:response.status,headers:response.headers});
  };
  const root=await mkdtemp(join(process.env.TMPDIR!,"water-"));
  const rules:any=await main(["rules","--source","water","--archive",root],f.deps);
  expect(rules.summary.catalogItems).toBe(1);
  const args=["collect","--source","water","--item",id,"--layer","7","--archive",root,"--terms-sha256",terms(item).sha256];
  const result:any=await main(args,f.deps);
  expect(result.summary).toMatchObject({source:"water",records:13,layer:7,service:waterService});
  expect(calls.some(u=>u.includes("/search"))).toBe(false);
  const before=calls.length;
  expect((await main(args,f.deps) as any).reused).toBe(true);
  expect((await main(["verify","--archive",root],f.deps) as any).collections).toBe(1);
  expect(calls.length).toBe(before);
  await expect(main([...args,"--max-records","12"],f.deps)).rejects.toThrow("current record bound");
  await expect(main([...args,"--response-bytes","1"],f.deps)).rejects.toThrow("current response bound");
  expect(calls.length).toBe(before);
});

test("Austin catalog selection preserves native rows, offline reuse and explicit city authority", async () => {
  expect(source("austin")).toBe("austin");
  const f=fixture(), calls:string[]=[], original=f.deps.fetch;
  const city="https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/Other_Boundary/FeatureServer";
  const cityItem={...item,url:city};
  f.deps.fetch=async(url:string)=>{
    calls.push(url);
    const replaced=url.replace(configs.austin.site,configs.tnr.site).replace(city,service);
    const response=await original(replaced);
    if(url === "https://services.arcgis.com/robots.txt") return new Response("Invalid URL",{status:403});
    if(url.endsWith("robots.txt")) return response;
    return new Response((await response.text()).replaceAll(configs.tnr.site,configs.austin.site).replaceAll(service,city),{status:response.status,headers:response.headers});
  };
  const root=await mkdtemp(join(process.env.TMPDIR!,"austin-"));
  const args=["collect","--source","austin","--item",id,"--layer","7","--archive",root,"--terms-sha256",terms(cityItem).sha256];
  const result:any=await main(args,f.deps);
  expect(result.summary).toMatchObject({source:"austin",records:13,layer:7,service:city});
  expect(calls.some(u=>u==="https://services.arcgis.com/robots.txt")).toBe(true);
  expect(calls.some(u=>u.includes("traviscountytx"))).toBe(false);
  const before=calls.length;
  expect((await main(args,f.deps) as any).reused).toBe(true);
  expect((await main(["verify","--archive",root],f.deps) as any).collections).toBe(1);
  expect(calls.length).toBe(before);
  await expect(main([...args,"--max-records","12"],f.deps)).rejects.toThrow("current record bound");
  await expect(main([...args,"--response-bytes","1"],f.deps)).rejects.toThrow("current response bound");
  expect(calls.length).toBe(before);
});
