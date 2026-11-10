import type {Engine} from './engine';
export function redirectTarget(source:string,from:string,status:number,location:string|null,kind:string):string {
 if(!source.startsWith('austin-') || status!==302 || !location) throw Error('unapproved redirect');
 const a=new URL(from),b=new URL(location,from);
 if(b.protocol!=='https:' || b.username || b.password || b.port || b.hash || b.search) throw Error('unsafe redirect target');
 if(kind==='robots' && from==='https://services.austintexas.gov/robots.txt' && b.href==='https://www.austintexas.gov/robots.txt') return b.href;
 const council=/^\/council\/(?:archive\/[^/]*(?:council|index)[^/]*|\d{4}\/[^/]*index[^/]*)$/;
 const canonical=/^\/(?:content\/archive-council-meetings-held-\d{4}|council\/(?:archive\/[^/]*(?:council|index)[^/]*|\d{4}\/[^/]*index[^/]*))$/;
 if(kind==='page' && a.origin==='https://www.austintexas.gov' && b.origin===a.origin && council.test(a.pathname) && canonical.test(b.pathname) && a.href!==b.href) return b.href;
 throw Error('unapproved redirect route');
}
export function hasRedirectSchema(engine:Engine):boolean {
 return engine.db.query<{version:number},[]>('SELECT version FROM archive_schema').get()?.version===4;
}
export type Edge={attempt:string;target_url:string;target_attempt:string|null};
export function redirectEdges(engine:Engine):Edge[] {return hasRedirectSchema(engine)?engine.db.query<Edge,[]>('SELECT * FROM redirect_edges').all():[];}
export function verifyRedirects(engine:Engine):void {
 const edges=redirectEdges(engine),byId=new Map(edges.map(e=>[e.attempt,e]));
 const gate=engine.db.query<{blocked:string|null},[]>('SELECT blocked FROM cooldowns').get()!;
 for(const edge of edges) {
  const a=engine.db.query<any,[string]>('SELECT a.*,r.source,r.id run_id FROM attempts a JOIN runs r ON r.id=a.run WHERE a.id=?').get(edge.attempt);
  if(!a || !a.run_id.startsWith('transport-work-v3:') || a.status!==302 || a.error!==null || a.ended===null) throw Error('redirect edge original receipt invalid');
  if(redirectTarget(a.source,a.url,a.status,new Headers(JSON.parse(a.headers)).get('location'),a.kind)!==edge.target_url) throw Error('redirect edge Location mismatch');
  if(edge.target_attempt===null) {if(!gate.blocked) throw Error('unfinished redirect without stop');continue;}
  const b=engine.db.query<any,[string]>('SELECT a.*,r.source FROM attempts a JOIN runs r ON r.id=a.run WHERE a.id=?').get(edge.target_attempt);
  if(!b || b.source!==a.source || b.kind!==a.kind || b.url!==edge.target_url || b.started<a.ended+3000) throw Error('redirect downstream identity/pacing mismatch');
  const visited=new Set<string>();let current:Edge|undefined=edge;
  while(current) {if(visited.has(current.attempt) || visited.size>=3) throw Error('redirect cycle/hop ceiling');visited.add(current.attempt);current=current.target_attempt?byId.get(current.target_attempt):undefined;}
 }
}
export function boundRobots(engine:Engine,origin:string,hash:string):boolean {
 if(!hasRedirectSchema(engine)) return false;
 const row=engine.db.query<any,[string]>('SELECT b.*,a.url,a.status,a.headers,r.decoded_hash FROM robots_bindings b JOIN attempts a ON a.id=b.final_attempt JOIN representations r ON r.attempt=a.id WHERE b.origin=?').get(origin);
 if(!row) return false;
 const edge=redirectEdges(engine).find(e=>e.attempt===row.redirect_attempt);
 if(origin!=='https://services.austintexas.gov' || !edge || edge.target_attempt!==row.final_attempt || edge.target_url!=='https://www.austintexas.gov/robots.txt' || row.url!==edge.target_url || row.status!==200 || row.decoded_hash!==hash || !/^text\/plain(?:;|$)/i.test(new Headers(JSON.parse(row.headers)).get('content-type')??'')) throw Error('redirect robots policy binding invalid');
 const original=engine.db.query<{url:string},[string]>('SELECT url FROM attempts WHERE id=?').get(edge.attempt);
 if(original?.url!==origin+'/robots.txt') throw Error('redirect robots original origin mismatch');
 return true;
}
