import {expect,test} from "bun:test";
import {CivicClerkClient} from "../src/client";
test("resumed CivicClerk state rejects tampered bounds, unsafe links and duplicate history before transport",async()=>{
 let calls=0;
 const api=new CivicClerkClient({async getJson<T>():Promise<T>{calls++; return {value:[{id:1,eventName:"Fixture",eventDate:"2030-03-04T00:00:00Z",publishedFiles:[]}],"@odata.count":2,"@odata.nextLink":"?$skip=1"} as T;},async request<T>():Promise<T>{throw new Error("unexpected");}},"https://example.test/v1/");
 const first=await api.listEventsPage("2030-03-04","2030-03-04",{maxPages:1}); const state=first.continuation!;
 const history=new URL(state.visited[0]!);history.searchParams.set('evil','1');
 const deltas=[{next:state.next.replace('%24skip=1','%24skip=2').replace('$skip=1','$skip=2')},{visited:[history.href]},{version:2},{query:"changed"},{ids:[0]},{ids:[1,1]},{count:-1},{count:0},{next:"https://other.test/v1/Events?$skip=1"},{next:"https://example.test/v1/Events?$skip=1&evil=1"},{next:"https://example.test/v1/Events?$skip=0"},{next:"https://example.test/v1/Events?$skiptoken= "},{visited:["https://other.test/v1/Events"]},{visited:null},{ids:null}];
 for(const delta of deltas) {
   await expect(api.listEventsPage("2030-03-04","2030-03-04",{continuation:{...state,...delta} as any})).rejects.toThrow();
   expect(calls).toBe(1);
 }
 await expect(api.listEventsPage("2030-03-04","2030-03-04",{maxPages:0})).rejects.toThrow(/budget/); expect(calls).toBe(1);
 await expect(api.listEventsPage("2030-03-04","2030-03-04",{continuation:state})).rejects.toThrow(/duplicate/); expect(calls).toBe(2);
});
