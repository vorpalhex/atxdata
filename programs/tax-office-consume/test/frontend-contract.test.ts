import {test,expect} from 'bun:test';
import {run} from '../src/cli';
import {help,information,parseOptions,writeOutput,tokenLabel,usage,type Commands} from '../src/frontend';

test('imported Tax selection errors preserve validation precedence before state opens',async()=>{
 const base=['collect','--output','/not-opened','--selection','delinquency'];
 await expect(run([...base,'--version','hash'])).rejects.toThrow('required --max-rows');
 for(const key of ['--version','--catalog-version'])await expect(run([...base,'--max-rows','1',key,'hash'])).rejects.toThrow('catalog/version selectors require catalog item selection');
 await expect(run(['import','--output','/not-opened','--selection','/item','--max-rows','1','--csv','/a','--layout','/b'])).rejects.toThrow('explicit supported selection required');
});

const commands:Commands={collect:{usage:'--item VALUE',description:'retain selection',options:['--item','--refresh'],flags:['--refresh'],notes:'bounded fixture'},list:{usage:'',description:'inspect',options:[]}};
test('imported help preserves top-level, command-local and contextual token decisions',()=>{
 expect(help(commands,'fixture')).toContain('Commands:');
 expect(help(commands,'fixture','collect')).toContain('--item VALUE');
 expect(help(commands,'fixture','collect')).toContain('--refresh\n');
 expect(help(commands,'fixture','list')).toContain('Usage:');
 expect(()=>help(commands,'fixture','absent')).toThrow('unknown help command');
 for(const args of [['--help'],['-h'],['help'],['help','collect'],['collect','--help'],['collect','-h'],['collect','--bad','--help'],['collect','--refresh','--help'],['collect','--item=x','--help']])expect(information(args,commands,'fixture')).toContain('Usage:');
 expect(information(['--version'],commands,'fixture')).toContain('0.1.0');
 for(const args of [[],['unknown','--help'],['collect','--','--help'],['collect','--item','--help'],['collect','--item','--']])expect(information(args,commands,'fixture')).toBeUndefined();
 expect(()=>information(['help','collect','extra'],commands,'fixture')).toThrow('help accepts one command');
 expect(tokenLabel('private value')).not.toContain('private value');expect(usage('collect')).toContain('help collect');
});
test('imported parser pins value, terminator, duplicate and error precedence',()=>{
 const parse=(args:string[],required:string[]=[])=>parseOptions(args,['--item','--refresh'],required,['--refresh']);
 expect([...parse(['--item=value','--refresh','--'])]).toEqual([['--item','value'],['--refresh','true']]);
 expect(parse(['--item','-h']).get('--item')).toBe('-h');
 expect(parse(['--item=--help']).get('--item')).toBe('--help');
 const cases:[string[],string][]=[
 [['operand'],'unexpected operand;'],[['--','--help'],'unexpected operand after --'],[['--ite'],'unknown option'],
 [['--item=x','--item'],'repeated option'],[['--refresh=false'],'bare flag'],[['--item='],'nonempty value'],
 [['--item','--help'],'nonempty value'],[['--item'],'nonempty value'],[['--item','--'],'nonempty value']];
 for(const [args,error] of cases)expect(()=>parse(args,['--item'])).toThrow(error);
 expect(()=>parse([],['--item'])).toThrow('required --item');
});
test('imported writer accepts a narrow descriptor/clock seam and preserves UTF8 partial bytes',async()=>{
 const parts:Buffer[]=[];let calls=0;
 const writer={now:()=>0,write:((fd:number,data:Buffer,offset:number,length:number,done:Function)=>{calls++;const n=Math.min(3,length);parts.push(Buffer.from(data.subarray(offset,offset+n)));queueMicrotask(()=>done(null,n));}) as any};
 const text='雪🙂é';await writeOutput(text,writer);
 expect(calls).toBe(3);expect(Buffer.concat(parts)).toEqual(Buffer.from(text));
});

test('imported writer preserves retry, zero-progress and private failure classification',async()=>{
 for(const mode of ['retry','zero','throw','EBADF','EPIPE','EIO']){
  let calls=0;const parts:Buffer[]=[];
  const writer={now:()=>0,write:((fd:number,data:Buffer,offset:number,length:number,done:Function)=>{
   calls++;if(mode==='throw')throw Object.assign(new Error('private detail'),{code:'EBADF'});
   queueMicrotask(()=>{
    if(mode==='retry'&&calls===1)return done(Object.assign(new Error('again'),{code:'EAGAIN'}),0);
    if(mode==='zero')return done(null,0);
    if(['EBADF','EPIPE','EIO'].includes(mode)&&calls===2)return done(Object.assign(new Error('private detail'),{code:mode}),0);
    const n=Math.min(3,length);parts.push(Buffer.from(data.subarray(offset,offset+n)));done(null,n);
   });
  }) as any};
  if(mode==='retry'){await writeOutput('雪🙂é',writer);expect(Buffer.concat(parts)).toEqual(Buffer.from('雪🙂é'));expect(calls).toBe(4);}
  else {let caught:any;try{await writeOutput('雪🙂é',writer);}catch(e){caught=e;}
   expect(caught.outputFailure).toBe(true);expect(caught.outputPending).toBe(false);expect(caught.message).not.toContain('private detail');
   if(mode!=='zero')expect(caught.code).toBe(mode==='throw'?'EBADF':mode);
  }
 }
 await writeOutput('',{now:()=>0,write:(()=>{throw new Error('empty output must not submit');}) as any});
});
test('imported monotonic deadline is cumulative across partial writes and retries',async()=>{
 for(const mode of ['pre','post','cumulative','retry']){
  let time=0,reads=0,calls=0;
  const writer={now:()=>{reads++;if(mode==='pre'&&reads===3)time=10000;return time;},write:((fd:number,data:Buffer,offset:number,length:number,done:Function)=>{
   calls++;queueMicrotask(()=>{
    time+=mode==='cumulative'?6000:10000;
    if(mode==='retry')done(Object.assign(new Error('again'),{code:'EAGAIN'}),0);
    else done(null,Math.min(3,length));
   });
  }) as any};
  let caught:any;try{await writeOutput('雪🙂é',writer);}catch(e){caught=e;}
  expect(caught.code).toBe('ETIMEDOUT');expect(caught.outputFailure).toBe(true);expect(caught.outputPending).toBe(true);
  expect(calls).toBe(mode==='pre'?0:mode==='cumulative'?2:1);
 }
});
