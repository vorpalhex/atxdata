import { test, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { collect, discover, verifyAcquisition } from '../src/acquisition';
import { validateRunOptions } from '../../arcgis-consume/src/policy';
const roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0))
    rmSync(p, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, 'ledger-')); roots.push(root); const sourceArchive = join(root, 'source'), output = join(root, 'import'); for (const p of [sourceArchive, output])
    mkdirSync(p, { mode: 0o700 }); let calls = 0, time = Date.now(); return { options: { sourceArchive, output, fiscalYear: 2032 }, calls: () => calls, deps: { now: () => time, sleep: async (ms: number) => { time += ms; }, fetch: async (url: string) => { calls++; return url.endsWith('robots.txt') ? new Response('', { status: 404 }) : new Response(null, { headers: { 'content-length': '38248830' } }); } } }; }
function edit(root: string, sql: string) { const db = new Database(join(root, 'state.sqlite')); try {
    db.exec(sql);
}
finally {
    db.close();
} }
function state(root: string) { const db = new Database(join(root, 'state.sqlite'), { readonly: true }); try {
    return JSON.stringify(['runs', 'attempts', 'cooldown', 'observations', 'versions', 'acquisition_options', 'sources', 'timing_events'].map(t => db.query(`SELECT * FROM ${t}`).all()));
}
finally {
    db.close();
} }
test('complete shared options validation happens before creating source/run state', async () => { const f = fixture(); let compatible = true; try {
    validateRunOptions({ fiscalYear: 2032, budget: { requests: 10, responseBytes: 104857600, zipBytes: 104857600, totalBytes: 209715200, records: 1000000, retries: 0 } });
}
catch {
    compatible = false;
} if (compatible)
    return; await expect(collect(f.options, f.deps)).rejects.toThrow(); expect(readdirSync(f.options.sourceArchive)).toEqual([]); expect(f.calls()).toBe(0); });
for (const fault of ['method', 'status', 'bodyBytes'])
    test(`rehashed HEAD ${fault} rejects verifier and new selection before mutation`, async () => { const f = fixture(); await discover({ ...f.options, years: [2032] }, f.deps); const db = new Database(join(f.options.sourceArchive, 'state.sqlite')); const o = db.query<any, [
    ]>("SELECT * FROM observations WHERE label='head:2032'").get(); const path = join(f.options.sourceArchive, o.path); const envelope = JSON.parse(readFileSync(path, 'utf8')); envelope[fault] = fault === 'method' ? 'GET' : fault === 'status' ? 201 : 5; const raw = Buffer.from(JSON.stringify(envelope)), sha = createHash('sha256').update(raw).digest('hex'); chmodSync(path, 0o600); writeFileSync(path, raw); db.query('UPDATE observations SET sha256=?,bytes=? WHERE label=?').run(sha, raw.length, o.label); db.query('UPDATE versions SET sha256=?,bytes=? WHERE label=?').run(sha, raw.length, o.label); db.query('UPDATE attempts SET bytes=? WHERE label=?').run(raw.length, o.label);
        // Keep independent completion byte accounting coherent to isolate envelope semantics.
        db.query("UPDATE timing_events SET detail=json_set(detail,'$.bytes',?) WHERE phase='complete' AND attempt=(SELECT id FROM attempts WHERE run=? AND label=?)").run(raw.length,o.run,o.label); db.close(); const before = state(f.options.sourceArchive), calls = f.calls(); await expect(verifyAcquisition(f.options.sourceArchive, f.options.output)).rejects.toThrow(); expect(state(f.options.sourceArchive)).toBe(before); await expect(discover({ ...f.options, years: [2033] }, f.deps)).rejects.toThrow(); expect(f.calls()).toBe(calls); expect(state(f.options.sourceArchive)).toBe(before); });
const faults: Record<string, string> = { robotsURL: "UPDATE attempts SET url='https://invalid.example/robots.txt' WHERE label='robots'", robotsStatus: "UPDATE attempts SET status=201 WHERE label='robots'", attemptOrder: "UPDATE attempts SET finished='1900-01-01T00:00:00.000Z' WHERE label='head:2032'", runOrder: "UPDATE runs SET started='2099-01-01T00:00:00.000Z'", retrieval1900: "UPDATE observations SET retrieved='1900-01-01T00:00:00.000Z'; UPDATE versions SET first_retrieved='1900-01-01T00:00:00.000Z'", future: "UPDATE attempts SET started='2999-01-01T00:00:00.000Z'", summary: "UPDATE runs SET summary=json_set(summary,'$.completeHistory',1)", selection: "UPDATE acquisition_options SET options=json_set(options,'$.years[0]',2033)" };
for (const [name, sql] of Object.entries(faults))
    test(`historical ${name} fails read-only before any new-year HTTP`, async () => { const f = fixture(); await discover({ ...f.options, years: [2032] }, f.deps); edit(f.options.sourceArchive, sql); const before = state(f.options.sourceArchive), calls = f.calls(); await expect(verifyAcquisition(f.options.sourceArchive, f.options.output)).rejects.toThrow(); expect(state(f.options.sourceArchive)).toBe(before); await expect(discover({ ...f.options, years: [2033] }, f.deps)).rejects.toThrow(); expect(f.calls()).toBe(calls); expect(state(f.options.sourceArchive)).toBe(before); });
for (const sql of ["UPDATE cooldown SET not_before='broken'", "UPDATE cooldown SET not_before=-1", "DELETE FROM cooldown"])
    test(`provider cooldown corruption remains rejected without repair: ${sql}`, async () => { const f = fixture(); await discover({ ...f.options, years: [2032] }, f.deps); edit(f.options.sourceArchive, sql); const before = state(f.options.sourceArchive), calls = f.calls(); await expect(discover({ ...f.options, years: [2033] }, f.deps)).rejects.toThrow(); expect(f.calls()).toBe(calls); expect(state(f.options.sourceArchive)).toBe(before); });
