import {test,expect} from 'bun:test';
import {mkdtemp,realpath,rm,readFile,writeFile,unlink,symlink} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {Collector} from '../src/collector';
import {replay} from './collector.test';
test('offline verify rejects same-length corruption, missing files, symlinks, decoded metadata and normalized row corruption',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-verify-')),c=await Collector.open(root,replay());
 try{await c.collect('125662');const row=c.db.query("SELECT id,path,decoded_hash FROM files WHERE name='summary'").get() as {id:string;path:string;decoded_hash:string},path=join(root,row.path),original=await readFile(path);
  const corrupt=Buffer.from(original);corrupt[0]^=1;await writeFile(path,corrupt);await expect(c.verify()).rejects.toThrow('hash mismatch');await writeFile(path,original);
  await unlink(path);await expect(c.verify()).rejects.toThrow('missing');await writeFile(path,original);
  await unlink(path);await writeFile(path+'.other',original);await symlink(path+'.other',path);await expect(c.verify()).rejects.toThrow('symlink');await unlink(path);await writeFile(path,original);
  c.db.query("UPDATE files SET decoded_hash='bad' WHERE id=?").run(row.id);await expect(c.verify()).rejects.toThrow('decoded hash mismatch');c.db.query('UPDATE files SET decoded_hash=? WHERE id=?').run(row.decoded_hash,row.id);
  c.db.query('UPDATE result_rows SET votes=votes+1').run();await expect(c.verify()).rejects.toThrow('stored row mismatch');
 }finally{await c.close();await rm(root,{recursive:true,force:true});}
});
test('SQLite checkpoint filenames cannot escape the archive even when matching bytes exist outside it',async()=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'clarity-path-')),c=await Collector.open(root,replay()),external=join(dirname(root),basename(root)+'-outside');
 try{await c.collect('125662');const row=c.db.query("SELECT id,path FROM files WHERE name='summary'").get() as {id:string;path:string};await writeFile(external,await readFile(join(root,row.path)),{flag:'wx'});
  c.db.query('UPDATE files SET path=? WHERE id=?').run('../'+basename(external),row.id);await expect(c.verify()).rejects.toThrow('unsafe archived filename');
 }finally{await c.close();await rm(root,{recursive:true,force:true});await rm(external,{force:true});}
});
