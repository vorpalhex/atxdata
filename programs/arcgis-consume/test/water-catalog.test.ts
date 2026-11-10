import {test,expect} from "bun:test";
import {waterCatalog} from "../src/water";
import {configs,itemUrl} from "../src/sources";
import type {Archive} from "../src/archive";
import {catalogEntry} from "../src/catalog";
const map="a".repeat(32), item="b".repeat(32);
test("explicit Water layer selects matching advertised entry of same item",()=>{
 const entries=[{id:item,map,url:root+"/3"},{id:item,map,url:root+"/9"}];
 expect(catalogEntry(entries,item,9)?.url).toBe(root+"/9");
});
const root="https://services1.arcgis.com/PuB3FWUAxkScvfQy/arcgis/rest/services/Public_Outages/FeatureServer";
function request(layers:unknown[],official=true):Archive["request"] {
 return async(_run,_label,url)=>{
  if(url===configs.water.hub) return official ? '<a href="https://www.arcgis.com/apps/dashboards/'+configs.water.site+'">Water</a>' : "different official link";
  if(url===itemUrl(map)) return {id:map,title:"Map",access:"public",type:"Web Map"};
  if(url===itemUrl(map,true)) return {operationalLayers:layers};
  throw Error("unexpected fixture URL");
 };
}
const dashboard={desktopView:{widgets:[{type:"mapWidget",itemId:map}]}};
const layer={itemId:item,url:root+"/3",title:"Public areas",layerType:"ArcGISFeatureLayer"};
test("Water metadata includes separate advertised layers of one item, deduplicates aliases and preserves wrapper references",async()=>{
 const result=await waterCatalog(request([layer,{...layer,title:"Alias"},{layerType:"GroupLayer",layers:[{...layer,url:root+"/9"}]}]),"run",dashboard,2);
 expect(result.items.map(v=>v.url)).toEqual([root+"/3",root+"/9"]);
 expect(result.catalogItems).toBe(2);
});
