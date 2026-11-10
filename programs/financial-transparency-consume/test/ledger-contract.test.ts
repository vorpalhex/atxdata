import { test, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, chmodSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { collect, discover, verifyAcquisition } from '../src/acquisition';
import { validateSourceLedger } from '../src/source-ledger';
import { readonlySource } from '../src/readonly-source';
import {runAcquisitionCli} from '../src/acquisition-cli';
import {importCsv} from '../src/importer';
const roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0))
    rmSync(p, { recursive: true, force: true }); });
const header = 'Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate';
function fixture() { const root = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, 'contract-')); roots.push(root); const sourceArchive = join(root, 'source'), output = join(root, 'import'); for (const p of [sourceArchive, output])
    mkdirSync(p, { mode: 0o700 }); let calls = 0, time = Date.now(); return { options: { sourceArchive, output, fiscalYear: 2032 }, calls: () => calls, deps: { now: () => time, sleep: async (ms: number) => { time += ms; }, fetch: async (url: string) => { calls++; return url.endsWith('robots.txt') ? new Response('', { status: 404 }) : new Response(`${header}\n2032,2026-10-01,0001,Authored,0002,1.01,,A,001,Example,002,fixture,\n`); } } }; }
function edit(root: string, sql: string) { const db = new Database(join(root, 'state.sqlite')); try {
    db.exec(sql);
}
finally {
    db.close();
} }
function snapshot(root: string) { return readdirSync(root).filter(n => !n.endsWith('-shm')).sort().map(n => [n, createHash('sha256').update(readFileSync(join(root, n))).digest('hex')]); }
for (const [field, value] of [['refresh', 'false'], ['refresh', null], ['maxBytes', null], ['maxRows', null], ['maxTotalBytes', null], ['maxRequests', null], ['unexpected', 1]])
    test(`runtime options reject ${field}=${value} before mutation`, async () => { const f = fixture(); await expect(collect({ ...f.options, [field as string]: value } as any, f.deps)).rejects.toThrow(); expect(readdirSync(f.options.sourceArchive)).toEqual([]); expect(f.calls()).toBe(0); });
const faults: Record<string, string> = {
    'attempt-end-before-start': "UPDATE attempts SET finished='1900-01-01T00:00:00.000Z' WHERE label='csv'",
    'run-start-after-finish': "UPDATE runs SET started='2099-01-01T00:00:00.000Z'",
    'import1900': "UPDATE runs SET summary=json_set(summary,'$.importedAt','1900-01-01T00:00:00.000Z')",
    'importFuture': "UPDATE runs SET summary=json_set(summary,'$.importedAt','2999-01-01T00:00:00.000Z')",
    'malformed-time': "UPDATE attempts SET started='not-a-date' WHERE label='csv'",
    'unsupported-status': "UPDATE runs SET status='unknown'",
    'unsupported-command': "UPDATE runs SET command='sync'",
    'unsupported-source': "UPDATE runs SET source='other'",
    'options-extra': "UPDATE acquisition_options SET options=json_set(options,'$.unknown',1)",
    'options-null': "UPDATE acquisition_options SET options=json_set(options,'$.budget.records',NULL)",
    'foreign-column': "ALTER TABLE runs ADD COLUMN foreign_column TEXT",
    'run-future-finish': "UPDATE runs SET finished='2999-01-01T00:00:00.000Z'",
    'request-accounting': "UPDATE acquisition_options SET options=json_set(options,'$.budget.requests',1)",
    'aggregate-accounting': "UPDATE acquisition_options SET options=json_set(options,'$.budget.totalBytes',1)",
    'missing-successful-policy': "UPDATE attempts SET status=200,error=NULL WHERE label='robots'",
    'missing-policy-context': "UPDATE attempts SET headers=NULL WHERE label='robots'",
    'duplicate-selected-attempt': "INSERT INTO attempts SELECT '00000000-0000-0000-0000-000000000000',run,label,url,started,finished,status,headers,bytes,error FROM attempts WHERE label='csv'",
};
for (const [name, sql] of Object.entries(faults))
    test(`collect ledger ${name} rejects before recovery or another year`, async () => { const f = fixture(); await collect(f.options, f.deps);  edit(f.options.sourceArchive, sql); const before = snapshot(f.options.sourceArchive), calls = f.calls(); await expect(verifyAcquisition(f.options.sourceArchive, f.options.output)).rejects.toThrow(); expect(snapshot(f.options.sourceArchive)).toEqual(before); await expect(collect({ ...f.options, fiscalYear: 2033 }, f.deps)).rejects.toThrow(); expect(f.calls()).toBe(calls); expect(snapshot(f.options.sourceArchive)).toEqual(before); });
for (const mutation of ['headers', 'declared-length', 'summary-year', 'summary-extra'])
    test(`discovery ${mutation} rejects coherent fault copy`, async () => { const f = fixture(); await discover({ ...f.options, years: [2032] }, f.deps); const db = new Database(join(f.options.sourceArchive, 'state.sqlite')); const o = db.query<any, [
    ]>("SELECT * FROM observations WHERE label='head:2032'").get(); if (mutation.startsWith('summary')) {
        db.exec(mutation === 'summary-year' ? "UPDATE runs SET summary=json_set(summary,'$.candidates[0].fiscalYear',2033)" : "UPDATE runs SET summary=json_set(summary,'$.unknown',1)");
    }
    else {
        const path = join(f.options.sourceArchive, o.path), e = JSON.parse(readFileSync(path, 'utf8'));
        if (mutation === 'headers')
            e.headers['x-authored'] = 'changed';
        else
            e.headers['content-length'] = '-1';
        const raw = Buffer.from(JSON.stringify(e)), sha = createHash('sha256').update(raw).digest('hex');
        chmodSync(path, 0o600);
        writeFileSync(path, raw);
        db.query('UPDATE observations SET sha256=?,bytes=? WHERE label=?').run(sha, raw.length, o.label);
        db.query('UPDATE versions SET sha256=?,bytes=? WHERE label=?').run(sha, raw.length, o.label);
        db.query('UPDATE attempts SET bytes=? WHERE label=?').run(raw.length, o.label);
        // Keep independent completion byte accounting coherent to isolate envelope semantics.
        db.query("UPDATE timing_events SET detail=json_set(detail,'$.bytes',?) WHERE phase='complete' AND attempt=(SELECT id FROM attempts WHERE run=? AND label=?)").run(raw.length,o.run,o.label);
    } db.close(); const before = snapshot(f.options.sourceArchive); await expect(verifyAcquisition(f.options.sourceArchive, f.options.output)).rejects.toThrow(); expect(snapshot(f.options.sourceArchive)).toEqual(before); });
test('CLI bounded range executes metadata only with public-safe result', async () => {
    const f = fixture(), lines: string[] = [];
    const deps = { ...f.deps, fetch: async () => new Response(null, { status: 404 }) };
    expect(await runAcquisitionCli(['discover', '--source-archive', f.options.sourceArchive, '--first-year', '1981', '--last-year', '1982'], s => lines.push(s), deps)).toBe(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({ completeHistory: false, candidates: [{ fiscalYear: 1981, status: 'unavailable' }, { fiscalYear: 1982, status: 'unavailable' }] });
    expect(await runAcquisitionCli(['discover', '--source-archive', f.options.sourceArchive, '--fiscal-year', '1981'], () => { }, deps)).toBe(0);
    expect(await runAcquisitionCli(['verify-source', '--source-archive', f.options.sourceArchive, '--output', f.options.output], () => { })).toBe(0);
});
for (const outcome of ['unsupported', 'unavailable', 'transport'])
    test(`legitimate failed ${outcome} producer stays verifiable without new HTTP`, async () => {
        const f = fixture();
        const deps = { ...f.deps, fetch: async (url: string) => { if (url.endsWith('robots.txt'))
                return new Response('', { status: 404 }); if (outcome === 'transport')
                throw new TypeError('authored transport failure'); if (outcome === 'unavailable')
                return new Response('', { status: 404 }); return new Response('not CSV'); } };
        if (outcome === 'unavailable')
            expect(await collect(f.options, deps)).toMatchObject({ status: 'unavailable' });
        else
            await expect(collect(f.options, deps)).rejects.toThrow();
        expect(await verifyAcquisition(f.options.sourceArchive, f.options.output)).toMatchObject({ integrity: 'ok', bindings: 0, httpRequests: 0 });
    });
test('bound importer orphan is rejected before source policy mutation', async () => {
    const f = fixture();
    await collect(f.options, f.deps);

    writeFileSync(join(f.options.output, 'orphan.csv'), 'authored', { mode: 0o600 });
    const before = snapshot(f.options.sourceArchive), calls = f.calls();
    await expect(verifyAcquisition(f.options.sourceArchive, f.options.output)).rejects.toThrow();
    expect(snapshot(f.options.sourceArchive)).toEqual(before);
    await expect(discover({ ...f.options, years: [2033] }, f.deps)).rejects.toThrow();
    expect(snapshot(f.options.sourceArchive)).toEqual(before);
    expect(f.calls()).toBe(calls);
});
for (const [field, value] of [['accepted', 99], ['rowsRead', 99], ['bytes', 1]])
    test(`bound receipt ${field} rejects before source policy mutation`, async () => {
        const f = fixture();
        await collect(f.options, f.deps);

        edit(f.options.sourceArchive, `UPDATE runs SET summary=json_set(summary,'$.${field}',${value})`);
        const before = snapshot(f.options.sourceArchive);
        await expect(verifyAcquisition(f.options.sourceArchive, f.options.output)).rejects.toThrow();
        expect(snapshot(f.options.sourceArchive)).toEqual(before);
    });
for(const kind of ['csv','robots'])test(`unexpected successful HTTP201 ${kind} never becomes a successful binding`,async()=>{
 const f=fixture();const deps={...f.deps,fetch:async(url:string)=>{const response=await f.deps.fetch(url);if(url.endsWith('robots.txt'))return kind==='robots'?new Response('User-agent: *',{status:201}):response;const raw=await response.text();return new Response(raw,{status:kind==='csv'?201:200});}};
 await expect(collect(f.options,deps)).rejects.toThrow();expect(readdirSync(f.options.output)).toEqual([]);expect(await verifyAcquisition(f.options.sourceArchive,f.options.output)).toMatchObject({bindings:0});
});
test('unchanged refresh retains the original import timestamp and remains reusable',async()=>{
 const f=fixture();const first=await collect(f.options,f.deps);await Bun.sleep(5);const second=await collect({...f.options,refresh:true},f.deps);expect(second).toMatchObject({fileSHA256:(first as any).fileSHA256,importedAt:(first as any).importedAt,reused:true});expect(await verifyAcquisition(f.options.sourceArchive,f.options.output)).toMatchObject({bindings:2});expect(await collect(f.options,f.deps)).toMatchObject({reused:true});
});
test('preexisting exact v1 import retains its historical timestamp when acquired',async()=>{
 const f=fixture(),file=join(f.options.output,'..','authored.csv');const response=await f.deps.fetch('https://authored.invalid/file');writeFileSync(file,await response.text(),{mode:0o600});const batch=importCsv({file,output:f.options.output,fiscalYear:2032});await Bun.sleep(5);expect(await collect(f.options,f.deps)).toMatchObject({reused:true,importedAt:batch.importedAt});expect(await verifyAcquisition(f.options.sourceArchive,f.options.output)).toMatchObject({bindings:1});
});
test('closed checkpointed WAL archive verifies without first creating policy files',async()=>{
 const f=fixture();await collect(f.options,f.deps);const d=new Database(join(f.options.sourceArchive,'state.sqlite'));d.exec('PRAGMA wal_checkpoint(TRUNCATE)');d.close();const closed=join(f.options.sourceArchive,'..','closed-source');mkdirSync(closed,{mode:0o700});for(const name of readdirSync(f.options.sourceArchive).filter(n=>!n.endsWith('-wal')&&!n.endsWith('-shm')))cpSync(join(f.options.sourceArchive,name),join(closed,name));expect(readFileSync(join(closed,'state.sqlite'))[18]).toBe(2);expect(await verifyAcquisition(closed,f.options.output)).toMatchObject({bindings:1,httpRequests:0});
});
test('orphan source body without a database rejects before creating any ledger',async()=>{
 const f=fixture();writeFileSync(join(f.options.sourceArchive,'00000000-0000-0000-0000-000000000000.body'),'authored',{mode:0o600});const before=snapshot(f.options.sourceArchive);await expect(collect(f.options,f.deps)).rejects.toThrow();expect(snapshot(f.options.sourceArchive)).toEqual(before);expect(f.calls()).toBe(0);
});
test('failed unsupported producer cannot be relabeled with a smaller historical total budget',async()=>{
 const f=fixture();await expect(collect(f.options,{...f.deps,fetch:async(url:string)=>url.endsWith('robots.txt')?new Response('',{status:404}):new Response('unsupported')})).rejects.toThrow();edit(f.options.sourceArchive,"UPDATE acquisition_options SET options=json_set(options,'$.budget.totalBytes',1)");await expect(verifyAcquisition(f.options.sourceArchive,f.options.output)).rejects.toThrow();
});
test('historical successful CSV still obeys its persisted positive row budget',async()=>{
 const f=fixture();await collect(f.options,{...f.deps,fetch:async(url:string)=>{const r=await f.deps.fetch(url);if(url.endsWith('robots.txt'))return r;const text=await r.text();return new Response(text+text.split('\n')[1]+'\n');}});edit(f.options.sourceArchive,"UPDATE acquisition_options SET options=json_set(options,'$.budget.records',1)");await expect(verifyAcquisition(f.options.sourceArchive,f.options.output)).rejects.toThrow();
});
function clockFixture() {
 const f=fixture();let now=100000;
 return {...f,deps:{...f.deps,clockDomain:'financial-authored-v1',now:()=>now,sleep:async(ms:number)=>{now+=ms}}};
}
function readonlyLedger(root:string) {
 const db=new Database(join(root,'state.sqlite'),{readonly:true,strict:true});
 try { return validateSourceLedger(db,root); } finally { db.close(); }
}
function settledVerificationEvidence(root:string) {
 const db=readonlySource(join(root,'state.sqlite'));
 try {
  const tables=['acquisition_options','attempts','cooldown','observations','runs','sources','timing_events','versions'];
  return {
   schema:db.query("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(),
   tables:tables.map(name=>({name,rows:db.query(`SELECT * FROM ${name} ORDER BY rowid`).all()})),
   bodies:readdirSync(root).filter(name=>name.endsWith('.body')).sort().map(name=>[name,createHash('sha256').update(readFileSync(join(root,name))).digest('hex')]),
  };
 } finally { db.close(); }
}
test('clock contract: independent injected provider epoch maps to wall evidence',async()=>{
 const f=clockFixture();await collect(f.options,f.deps);
 expect(()=>readonlyLedger(f.options.sourceArchive)).not.toThrow();
 // A retired producer may checkpoint main/WAL files at GC. Positive settled
 // verification preserves logical evidence and original bodies, not file layout.
 const beforeVerify=settledVerificationEvidence(f.options.sourceArchive),verifyCalls=f.calls();
 Bun.gc(true);
 expect(await verifyAcquisition(f.options.sourceArchive,f.options.output)).toMatchObject({bindings:1,httpRequests:0});
 expect(settledVerificationEvidence(f.options.sourceArchive)).toEqual(beforeVerify);
 expect(f.calls()).toBe(verifyCalls);
 const calls=f.calls();expect(await collect(f.options,f.deps)).toMatchObject({reused:true});expect(f.calls()).toBe(calls);
});
test('clock contract:2077 observation/version plus mutable gate rejects directly read-only',async()=>{
 const f=fixture();await collect(f.options,f.deps);
 edit(f.options.sourceArchive,"UPDATE observations SET retrieved='2077-01-01T00:00:00.000Z';UPDATE versions SET first_retrieved='2077-01-01T00:00:00.000Z';UPDATE cooldown SET not_before=3376684803000");
 const before=snapshot(f.options.sourceArchive),calls=f.calls();
 expect(()=>readonlyLedger(f.options.sourceArchive)).toThrow();
 expect(snapshot(f.options.sourceArchive)).toEqual(before);
 await expect(verifyAcquisition(f.options.sourceArchive,f.options.output)).rejects.toThrow();
 await expect(discover({...f.options,years:[2033]},f.deps)).rejects.toThrow();expect(f.calls()).toBe(calls);expect(snapshot(f.options.sourceArchive)).toEqual(before);
});
const timingFaults:Record<string,string>={
 missingCheckpoint:"DELETE FROM timing_events WHERE phase='checkpoint'",
 mixedDomain:"UPDATE timing_events SET domain='other' WHERE phase='checkpoint'",
 wallMapping:"UPDATE timing_events SET wall_ms=wall_ms+600000 WHERE phase='checkpoint'",
 wallBeforeAttempt:"UPDATE timing_events SET wall_ms=0 WHERE phase='checkpoint'",
 producerRetrieval:"UPDATE timing_events SET detail=json_set(detail,'$.retrieved','2077-01-01T00:00:00.000Z') WHERE phase='checkpoint'",
 manualStop:'UPDATE cooldown SET not_before=9007199254740991',
 gateRollback:'UPDATE cooldown SET not_before=0',
 missingEvidence:'DELETE FROM timing_events',
 foreignTimingSchema:'ALTER TABLE timing_events ADD COLUMN unknown_fact TEXT',
 foreignTable:'CREATE TABLE unknown_table (id TEXT)',
};
for(const [name,sql]of Object.entries(timingFaults))test(`clock contract:${name} rejects before writes/HTTP`,async()=>{
 const f=clockFixture();await collect(f.options,f.deps);edit(f.options.sourceArchive,sql);const before=snapshot(f.options.sourceArchive),calls=f.calls();
 if(!name.startsWith('foreign'))expect(()=>readonlyLedger(f.options.sourceArchive)).toThrow();
 await expect(verifyAcquisition(f.options.sourceArchive,f.options.output)).rejects.toThrow();
 await expect(collect({...f.options,fiscalYear:2033},f.deps)).rejects.toThrow();
 expect(f.calls()).toBe(calls);expect(snapshot(f.options.sourceArchive)).toEqual(before);
});
test('clock contract: genuine seven-table legacy requires review without migration',async()=>{
 const f=fixture();await collect(f.options,f.deps);edit(f.options.sourceArchive,'DROP TABLE timing_events');const before=snapshot(f.options.sourceArchive);
 await expect(verifyAcquisition(f.options.sourceArchive,f.options.output)).rejects.toThrow('operator review');expect(snapshot(f.options.sourceArchive)).toEqual(before);
});
test('cached aggregate limit is per-run bodies; per-file and row limits still apply', async () => { const f = fixture(); await collect(f.options, f.deps);  const calls = f.calls(); expect(await collect({ ...f.options, maxTotalBytes: 1 }, f.deps)).toMatchObject({ reused: true }); await expect(collect({ ...f.options, maxBytes: 1 }, f.deps)).rejects.toThrow(); expect(f.calls()).toBe(calls); });
