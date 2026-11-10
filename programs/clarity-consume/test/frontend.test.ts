import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const entry = new URL('../src/cli.ts', import.meta.url).pathname;
test('native information does not falsely succeed on read-only stdout', () => {
 const fd=require('node:fs').openSync(entry,'r');
 try { const p=Bun.spawnSync([process.execPath,entry,'--help'],{stdout:fd,stderr:'pipe'});expect(p.exitCode).toBe(1);expect(p.stderr.toString()).toContain('output');expect(p.stderr.toString()).not.toContain(entry); }
 finally {require('node:fs').closeSync(fd);}
});
test('offline top and local information bypass unusable archive from unrelated cwd', async () => {
 const cwd=mkdtempSync(join(process.env.TMPDIR!, 'clarity-front-'));
 try {
  for (const args of [['--help'],['-h'],['--version'],...['list','discover','collect','sync','status','verify'].flatMap(c=>[[c,'-h'],[c,'--help'],[c,'--version'],['help',c]])]) {
   const p=Bun.spawn([process.execPath,entry,...args,'--archive=/not-usable'],{cwd,stdin:'ignore',stdout:'pipe',stderr:'pipe'});
   const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
   expect(code).toBe(0);expect(err).toBe('');expect(out).toContain(args.at(-1)==='--version'?'clarity-consume 0.1.0':'Usage:');
  }
 } finally {rmSync(cwd,{recursive:true,force:true});}
});
