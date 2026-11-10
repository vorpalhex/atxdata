import {RobotsDisallow,robotsPolicy} from './policy';
export type HumanAcknowledgement={human:true;url:string;robotsSha256:string;matchedRule:string;scope:'encodeplus-travis-robots-v1'};
export function humanOption(value:unknown):boolean {
 if(value===undefined) return false;
 if(typeof value!=='boolean') throw Error('human must be a boolean');
 return value;
}
export function humanScope(url:string):boolean {
 const u=new URL(url);
 return u.origin==='https://online.encodeplus.com' && !u.username && !u.password && u.pathname.startsWith('/regs/traviscounty-tx/');
}
export function robotsDecision(body:string,hash:string,url:string,human:boolean):{delay:number;acknowledgement?:HumanAcknowledgement} {
 const acknowledged=humanOption(human);
 try {return {delay:robotsPolicy(body,new URL(url).pathname+new URL(url).search)};}
 catch(error) {
  if(!(error instanceof RobotsDisallow) || !acknowledged || !humanScope(url)) throw error;
  return {delay:error.delay,acknowledgement:{human:true,url,robotsSha256:hash,matchedRule:error.rule,scope:'encodeplus-travis-robots-v1'}};
 }
}
