import {expect,test} from "bun:test";
import {calendarRange,listingState,positiveLimit} from "../../src/legistar/listing";
import {LegistarApiClient} from "../../src/legistar/api-client";
import type {AppConfig} from "../../src/config";
test("listing budgets and calendar ranges fail closed",()=>{
  for(const n of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) expect(()=>positiveLimit(n,100)).toThrow();
  expect(positiveLimit(undefined,100)).toBe(100); expect(positiveLimit(1,100)).toBe(1);
  for(const pair of [["+010000-01","2030-03-04"],["2030-2-01","2030-02-01"],["2030-02-29","2030-03-01"],["xxxx-yy-zz","2030-03-01"],["2030-03-05","2030-03-04"]]) expect(()=>calendarRange(pair[0]!,pair[1]!)).toThrow();
  expect(calendarRange("2024-02-29","2024-02-29")).toBe("2024-03-01");
});
test("continuation validates query, page size, offset and full unique ID history",()=>{
  const state={version:1 as const,query:"query",offset:2,ids:[11,12],pageSize:5};
  expect(listingState("query",5).offset).toBe(0);
  expect([...listingState("query",5,{...state,ids:[1,2]}).ids]).toEqual([1,2]);
  expect([...listingState("query",5,state).ids]).toEqual([11,12]);
  expect(listingState("query",5,{...state,offset:0,ids:[]}).offset).toBe(0);
  for(const delta of [{version:2},{query:"evil"},{pageSize:6},{offset:-1},{offset:1.5},{offset:1},{ids:null},{ids:[11,11]},{ids:[0,12]},{ids:[1.5,12]}]) expect(()=>listingState("query",5,{...state,...delta} as any)).toThrow();
});
test("collection rejects ignored offsets, bad shapes, oversized pages and out-of-range dates",async()=>{
  const config={apiBase:"https://example.test/v1",legistarClient:"city"} as AppConfig;
  for(const data of [{value:[]},[null],[{EventId:0}],[{EventId:1,EventDate:"2030-03-05"}],[{EventId:1},{EventId:2}]]) {
    const api=new LegistarApiClient(config,{async getJson<T>():Promise<T>{return data as T;},async fetchWithRetry(){throw new Error("unexpected");}});
    await expect(api.listEvents("2030-03-04","2030-03-04",undefined,{pageSize:1,maxPages:3})).rejects.toThrow();
  }
  let calls=0;
  const api=new LegistarApiClient(config,{async getJson<T>():Promise<T>{calls++;return [{EventId:7}] as T;},async fetchWithRetry(){throw new Error("unexpected");}});
  await expect(api.listEvents("2030-03-04","2030-03-04")).rejects.toThrow(/paging did not advance/); expect(calls).toBe(2);
});
