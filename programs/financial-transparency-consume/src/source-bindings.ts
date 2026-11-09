import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { archivePath, privateFile, artifacts } from './archive';
import { verifyDatabase } from './verify';
import { ensure, object } from './acquisition-options';
import { validateDefinitions } from './source-schema';
import type { Batch } from './model';
// Literal v1 contract, independently checked without opening the importer writer
// or running its PRAGMA setup. Keep exact compatibility with existing archives.
const schema = [
    'CREATE TABLE batches(fileSHA256 TEXT PRIMARY KEY NOT NULL,fiscalYear INTEGER NOT NULL,importedAt TEXT NOT NULL,bytes INTEGER NOT NULL,status TEXT NOT NULL,rowsRead INTEGER NOT NULL,accepted INTEGER NOT NULL,rejected INTEGER NOT NULL,sourceURL TEXT NOT NULL)',
    'CREATE TABLE rows(batch TEXT NOT NULL REFERENCES batches(fileSHA256),ordinal INTEGER NOT NULL,fields TEXT NOT NULL,cents TEXT,reason TEXT,PRIMARY KEY(batch,ordinal))',
];
function verifyImportSchema(db: Database) {
    validateDefinitions(db,schema,'foreign import schema');
    ensure((db.query('PRAGMA application_id').get() as any).application_id === 1179931472, 'foreign import application');
    ensure((db.query('PRAGMA user_version').get() as any).user_version === 1, 'foreign import version');
}
function verifyImportArtifacts(db: Database, output: string) {
    const hashes = db.query<{
        fileSHA256: string;
    }, [
    ]>('SELECT fileSHA256 FROM batches').all().map(r => r.fileSHA256);
    ensure(hashes.every(h => /^[a-f0-9]{64}$/.test(h)), 'invalid import hash');
    artifacts(output, hashes);
}
function verifyBatchBinding(db: Database, receipt: Record<string, any>) {
    const batch = db.query<Batch, [
        string
    ]>('SELECT * FROM batches WHERE fileSHA256=?').get(receipt.fileSHA256);
    ensure(batch, 'missing bound batch');
    for (const key of Object.keys(batch) as (keyof Batch)[])
        ensure(batch[key] === receipt[key], 'binding import mismatch');
}
function verifyOriginalBinding(source: Database, receipt: Record<string, any>) {
    const o = source.query<{
        url: string;
        kind: string;
        sha256: string;
        bytes: number;
    }, [
        string
    ]>("SELECT url,kind,sha256,bytes FROM observations WHERE run=? AND label='csv'").get(receipt.run);
    ensure(o && o.url === receipt.acquisitionURL && o.kind === 'file', 'binding original identity mismatch');
    ensure(o.sha256 === receipt.fileSHA256 && o.bytes === receipt.bytes, 'binding original accounting mismatch');
}
function verifyReadonlyImport(source: Database, receipt: Record<string, any>) {
    const output = receipt.output;
    archivePath(output);
    ensure(!existsSync(join(output, '.lock')), 'locked import archive');
    const path = join(output, 'state.sqlite');
    privateFile(path);
    const db = new Database(path, { readonly: true, strict: true });
    try {
        verifyImportSchema(db);
        verifyImportArtifacts(db, output);
        verifyDatabase(db, output);
        verifyBatchBinding(db, receipt);
        verifyOriginalBinding(source, receipt);
    }
    finally {
        db.close();
    }
}
export function preflightImportBindings(source: Database) {
    const runs = source.query<{
        summary: string;
    }, [
    ]>("SELECT summary FROM runs WHERE command='collect' AND status='succeeded'").all();
    for (const run of runs)
        verifyReadonlyImport(source, object(JSON.parse(run.summary)));
}
