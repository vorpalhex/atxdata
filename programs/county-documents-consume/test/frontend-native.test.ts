import {test,expect} from 'bun:test';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import {openSync,closeSync,writeFileSync,readFileSync,constants} from 'node:fs';
const entry=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
const commands=['list', 'verify', 'status', 'catalog', 'import-page', 'import-pdf', 'review-pdf', 'review-context', 'discover', 'collect', 'sync', 'archive'];
test('native contextual help/version bypass unusable configuration and never reinterpret values',async()=>{
 const cwd=await mkdtemp(join(process.env.TMPDIR!,'frontend-native-'));
 try {
  const invoke=(args:string[])=>spawnSync(process.execPath,[entry,...args],{cwd,env:{...process.env,HOME:cwd,XDG_CONFIG_HOME:cwd,TERM:'dumb',NO_COLOR:'1'},input:'',encoding:'utf8',timeout:10000});
  for(const args of [['-h'],['--help'],['help'],['--version'],...commands.flatMap(c=>[[c,'-h'],[c,'--help'],['help',c]])]){
   const result=invoke([...args,'--root','/dev/null']);
   expect(result.status).toBe(0);expect(result.stderr).toBe('');
   expect(result.stdout).toContain(args[0]==='--version'?'0.1.0':'Usage:');
   expect(result.stdout).not.toContain('\x1b');
  }
  expect(await readdir(cwd)).toEqual([]);
  // Bun consumes the first --; the second reaches the application parser.
  for(const args of [['--source','--help'],['--source=--help'],['--','--','--help'],['help','unknown']]){
   const result=invoke(args);expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).not.toContain(' at ');
  }
  const args=['--root='+join(cwd,'archive'),'status'];
  const healthy=invoke(args);expect(healthy.status).toBe(0);expect(healthy.stderr).toBe('');expect(()=>JSON.parse(healthy.stdout)).not.toThrow();
  for(const invalid of [['status','--root='],['status','--root','a','--root','b'],['status','--bogus'],['status','extra']]){const result=invoke(invalid);expect(result.status).toBe(1);expect(result.stdout).toBe('');}
 } finally {await rm(cwd,{recursive:true,force:true});}
});

test('native pure page URL rejection precedes fresh archive creation and preserves existing files',async()=>{
 const cwd=await mkdtemp(join(process.env.TMPDIR!,'frontend-page-url-'));
 try {
  const rootPage='https://www.traviscountytx.gov/commissioners-court/county-code';
  const child=rootPage+'/chapter-archive';
  const html=join(cwd,'authored.html');
  writeFileSync(html,`<h1>County Code</h1><a href="${child}">Chapter archive</a><a href="/images/commissioners_court/county_code/Chapter_1.pdf">Chapter 1</a>`);
  const invoke=(args:string[])=>spawnSync(process.execPath,[entry,...args],{cwd,env:process.env,input:'',encoding:'utf8',timeout:10000});
  const invalid=[
   ['https://example.invalid/','not an official HTTPS link'],
   [rootPage.replace('https:','http:'),'not an official HTTPS link'],
   ['https://www.traviscountytx.gov/contact','not a source-linked discovery path'],
   [rootPage+'/chapter.pdf','not a discovery page'],
   [rootPage+'/login','not a read-only discovery route'],
   [rootPage+'#fragment','noncanonical source-linked discovery URL'],
  ];
  for(const command of ['import-page','discover']) for(const [page,error] of invalid) {
   const root=join(cwd,`fresh-${command}-${invalid.findIndex(row=>row[0]===page)}`);
   const result=invoke([command,'--root',root,'--source','county-code','--page',page!,...(command==='discover'?['--allow-network']:['--input',html,'--origin','fixture'])]);
   expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toContain(error!);
   expect(result.stderr).not.toContain(' at ');
   expect(await readdir(cwd)).not.toContain(root.split('/').at(-1)!);
  }
  const archiveRoot=join(cwd,'invalid-archive');
  const archive=invoke(['archive','--root',archiveRoot,'--source-href','https://example.invalid/','--page','https://example.invalid/','--allow-network']);
  expect(archive.status).toBe(1);expect(archive.stdout).toBe('');expect(archive.stderr).toContain('unsafe archive source identity');
  expect(await readdir(cwd)).not.toContain('invalid-archive');
  const root=join(cwd,'valid');
  const status=invoke(['status','--root',root]);expect(status.status).toBe(0);expect(status.stderr).toBe('');expect(()=>JSON.parse(status.stdout)).not.toThrow();
  for(const page of [rootPage,child]) {
   const result=invoke(['import-page','--root',root,'--source','county-code','--page',page,'--input',html,'--origin','fixture']);
   expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(JSON.parse(result.stdout).occurrences).toBe(1);
  }
  const files=await readdir(root),before=files.map(name=>[name,readFileSync(join(root,name)).toString('hex')]);
  for(const command of ['import-page','discover']) {
   const result=invoke([command,'--root',root,'--source','county-code','--page','https://example.invalid/',...(command==='discover'?['--allow-network']:['--input',html,'--origin','fixture'])]);
   expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toContain('not an official HTTPS link');
   expect(await readdir(root)).toEqual(files);expect(files.map(name=>[name,readFileSync(join(root,name)).toString('hex')])).toEqual(before);
  }
 } finally {await rm(cwd,{recursive:true,force:true});}
});

test('native stdout failure is nonzero and closed pipe stays quiet',async()=>{
 const cwd=await mkdtemp(join(process.env.TMPDIR!,'frontend-output-'));
 try {
  const file=join(cwd,'readonly');writeFileSync(file,'unchanged');
  for(const args of [['--help'],['status','--root',join(cwd,'archive')]]){
   const fd=openSync(file,'r');
   try {
    const result=spawnSync(process.execPath,[entry,...args],{cwd,env:process.env,stdio:['ignore',fd,'pipe'],encoding:'utf8',timeout:10000});
    expect(result.status).toBe(1);expect(result.stderr).toMatch(/stdout.*EBADF/);expect(result.stderr).not.toContain(cwd);expect(result.stderr).not.toContain(' at ');
   } finally {closeSync(fd);}
  }
  expect(readFileSync(file,'utf8')).toBe('unchanged');
  const child=spawn(process.execPath,[entry,'--help'],{cwd,env:process.env,stdio:['ignore','pipe','pipe']});
  child.stdout!.destroy();let stderr='';child.stderr!.on('data',chunk=>stderr+=chunk);
  const status=await new Promise(resolve=>child.on('close',resolve));
  expect(status).toBe(0);expect(stderr).toBe('');
 } finally {await rm(cwd,{recursive:true,force:true});}
});

test('writer bounds a blocked reader and completely flushes a healthy large result',async()=>{
 const module=fileURLToPath(new URL('../src/cli-output.ts',import.meta.url));
 const code=`import {writeStdout} from ${JSON.stringify(module)};try{await writeStdout('x'.repeat(8*1024*1024));}catch(e){console.error(e.message);process.exitCode=1;}`;
 const healthy=spawnSync(process.execPath,['-e',code],{env:process.env,encoding:'utf8',maxBuffer:16*1024*1024,timeout:10000});
 expect(healthy.status).toBe(0);expect(healthy.stdout.length).toBe(8*1024*1024);expect(healthy.stderr).toBe('');
 // A real FIFO avoids Bun's child-process pipe auto-buffering in the parent.
 if(process.platform==='win32') return; // POSIX FIFO portion is not portable to Windows.
 const cwd=await mkdtemp(join(process.env.TMPDIR!,'frontend-fifo-')),fifo=join(cwd,'pipe');
 expect(spawnSync('mkfifo',[fifo]).status).toBe(0);
 const reader=openSync(fifo,constants.O_RDONLY|constants.O_NONBLOCK);
 const writer=openSync(fifo,constants.O_WRONLY|constants.O_NONBLOCK);
 try {
  const child=spawn(process.execPath,['-e',code],{env:process.env,stdio:['ignore',writer,'pipe']});
  let stderr='';child.stderr!.on('data',chunk=>stderr+=chunk);
  const watchdog=setTimeout(()=>child.kill('SIGKILL'),8000);
  const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(watchdog);
  expect(status).toBe(1);expect(stderr).toContain('ETIMEDOUT');
 } finally {closeSync(writer);closeSync(reader);await rm(cwd,{recursive:true,force:true});}
},15000);
