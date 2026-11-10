import {test,expect} from 'bun:test';import {catalogLinks,discover,acquire} from '../src/live';import {Store} from '../src/store';import {mkdtemp} from 'node:fs/promises';import {join} from 'node:path';
test('published catalog selects actual links and acquisition retains hash without global sample pins',async()=>{
 const html='<a href="/wp-content/largefiles/2024%20Supp%207.zip">2024 supplement</a><a href="https://other.test/a.zip">no</a>';
 const links=catalogLinks(html);expect(links).toHaveLength(1);expect(links[0]!.url).toContain('2024%20Supp%207.zip');
 const s=await Store.open(join(await mkdtemp(join(process.env.TMPDIR!,'live-')),'out'));
 const zipped=Bun.spawnSync(['python3','-c',"import io,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('STATE_CD.TXT','001\\r\\n'); z.close(); sys.stdout.buffer.write(b.getvalue())"]).stdout;
 let now=100000;const calls:string[]=[];const transport=async(url:string)=>{calls.push(url);return new Response(url.endsWith('robots.txt')?'User-agent: *\nDisallow:\nCrawl-delay: 10':url.endsWith('publicinformation')?html:new Uint8Array(zipped),{status:200});};
 const options={maxRequests:3,maxBytes:4096,transport,clock:()=>now,sleep:async(ms:number)=>{now+=ms;}};
 try{const c=await discover(s.db,s.root,options);expect(c).toHaveLength(1);const a=await acquire(s.db,s.root,c[0]!.id,options);expect(a.bytes).toBe(zipped.length);expect(calls).toHaveLength(3);expect(now).toBe(120000);expect(await acquire(s.db,s.root,c[0]!.id,options)).toMatchObject({reused:true});}finally{await s.close();}
});
