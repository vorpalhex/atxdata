import {fixture,service,id,item,layer,sr} from "./selection-fixture";
import {configs} from "../../src/sources";
export {id,item};
export function cityFixture(count=1201) {
 const f=fixture(),original=f.deps.fetch;
 const city="https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/Synthetic_Boundaries/FeatureServer";
 f.deps.fetch=async(url:string)=>{
  const u=new URL(url);
  if(url==="https://services.arcgis.com/robots.txt")return new Response("Invalid URL",{status:403});
  if(url.startsWith(city) && u.pathname.endsWith("/7"))return Response.json({...layer,maxRecordCount:400});
  if(url.startsWith(city) && u.pathname.endsWith("/query")) {
   if(u.searchParams.has("returnCountOnly"))return Response.json({count});
   if(u.searchParams.has("returnIdsOnly"))return Response.json({objectIdFieldName:"FID",objectIds:Array.from({length:count},(_,i)=>i+1)});
   const offset=Number(u.searchParams.get("resultOffset")),size=Math.min(400,count-offset);
   return Response.json({geometryType:layer.geometryType,spatialReference:sr,fields:layer.fields,exceededTransferLimit:offset+size<count,features:Array.from({length:size},(_,i)=>({attributes:{FID:offset+i+1,LABEL:"synthetic"},geometry:{x:i%20,y:i%20}}))});
  }
  const response=await original(url.replace(configs.austin.site,configs.tnr.site).replace(city,service));
  if(url.endsWith("robots.txt"))return response;
  return new Response((await response.text()).replaceAll(configs.tnr.site,configs.austin.site).replaceAll(service,city),{status:response.status,headers:response.headers});
 };
 return f;
}
