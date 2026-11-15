export function policyNumber(value:string|null):number {
 if(value===null || !/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error("ambiguous cooldown");
 const number=Number(value.trim());
 if(!Number.isFinite(number)) throw new Error("ambiguous cooldown");
 return number;
}
function retryAfter(headers:Headers,now:number):number {
 const value=headers.get("retry-after");
 if(value===null) return now;
 if(/^\d+(?:\.\d+)?$/.test(value.trim())) return now+policyNumber(value)*1000;
 const date=Date.parse(value),server=Date.parse(headers.get("date")??"");
 if(!Number.isFinite(date)) throw new Error("ambiguous Retry-After");
 return now+Math.max(0,date-(Number.isFinite(server)?server:now));
}
function quotaReset(headers:Headers,prefix:string,now:number):number {
 const remaining=headers.get(`${prefix}ratelimit-remaining`);
 const reset=headers.get(`${prefix}ratelimit-reset`);
 if(remaining===null) {
  if(reset!==null) throw new Error("ambiguous cooldown remaining");
  return now;
 }
 if(policyNumber(remaining)!==0) return now;
 const seconds=policyNumber(reset);
 return prefix?seconds*1000:now+seconds*1000;
}
function structuredReset(policy:string,now:number):number {
 const r=/(?:^|;)\s*r\s*=\s*(\d+(?:\.\d+)?)\s*(?:;|$)/.exec(policy);
 if(!r) throw new Error("ambiguous structured RateLimit");
 if(Number(r[1])!==0) return now;
 const t=/(?:^|;)\s*t\s*=\s*(\d+(?:\.\d+)?)\s*(?:;|$)/.exec(policy);
 if(!t) throw new Error("ambiguous structured reset");
 return now+Number(t[1])*1000;
}
export function cooldown(headers:Headers,now:number):number {
 const structured=headers.get("ratelimit");
 const policies=structured===null?[]:structured.split(",").map(policy=>structuredReset(policy,now));
 return Math.max(now,retryAfter(headers,now),quotaReset(headers,"",now),quotaReset(headers,"x-",now),...policies);
}
