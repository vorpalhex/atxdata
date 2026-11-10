import { Database } from 'bun:sqlite';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { positiveInteger, sourceURL } from './model';
import { privateFile } from './archive';
import { ensure as check, object, exactKeys, persistedOptions } from './acquisition-options';
import { validateTiming } from '../../arcgis-consume/src/timing';
type ClockFacts = ReturnType<typeof validateTiming>;
type Row = Record<string, any>;
type Range = {
    start: number;
    end: number;
};
type Ledger = {
    runs: Row[];
    attempts: Row[];
    observations: Row[];
    options: Row[];
    versions: Row[];
    sources: Row[];
};
const origin = 'https://tctransparency.traviscountytx.gov';
const robots = origin + '/robots.txt';
const file = (year: number) => `${origin}/Reports/DataSAP/PaymentRegister_${positiveInteger(year)}.csv`;
function rows(db: Database, table: string): Row[] {
    return db.query<Row, [
    ]>(`SELECT * FROM ${table} ORDER BY rowid`).all();
}
function timestamp(value: unknown): number {
    check(typeof value === 'string', 'missing ledger time');
    const n = Date.parse(value);
    check(Number.isFinite(n) && new Date(n).toISOString() === value, 'invalid ledger time');
    return n;
}
function ordered(value: unknown, low: number, high: number) {
    const n = timestamp(value);
    check(n >= low && n <= high, 'ledger chronology mismatch');
    return n;
}
function headers(value: unknown) {
    const h = object(value);
    for (const [key, v] of Object.entries(h))
        check(key === key.toLowerCase() && typeof v === 'string', 'invalid source headers');
    return h;
}
function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function headerEntries(value: Row) { return Object.entries(value).sort(); }
function declaredLength(original: Row) {
    const length = original['content-length'];
    if (length === undefined)
        return {};
    check(/^\d+$/.test(length) && Number.isSafeInteger(Number(length)), 'invalid declared length');
    return { declaredBytes: Number(length) };
}
export function metadataCandidate(year: number, envelope: unknown, derivedHeaders: unknown) {
    const e = object(envelope);
    exactKeys(e, ['bodyBytes', 'headers', 'method', 'status']);
    check(e.method === 'HEAD' && e.status === 200 && e.bodyBytes === 0, 'invalid metadata envelope');
    const original = headers(e.headers), derived = { ...original };
    delete derived['content-length'];
    delete derived['content-encoding'];
    check(equal(headerEntries(derived), headerEntries(headers(derivedHeaders))), 'derived headers mismatch');
    return { fiscalYear: year, status: 'metadata_available', contentValidated: false as const, ...declaredLength(original) };
}
function optionsFor(run: Row, stored: Row | undefined) {
    check(stored, 'missing acquisition options');
    const o = persistedOptions(JSON.parse(stored.options), run.command === 'discover');
    const expected = run.command === 'discover' ? 'financial:candidates' : `financial:${o.fiscalYear}`;
    check(run.source === expected, 'run year mismatch');
    return o;
}
function terminalRun(run: Row, start: number, now: number) {
    const end = ordered(run.finished, start, now);
    if (run.status === 'failed') {
        const errors = run.command === 'collect' ? ['acquisition_failed', 'unsupported_source'] : ['discovery_failed'];
        check(run.summary === null && errors.includes(run.error), 'invalid failed run');
    }
    else
        check(run.error === null && run.summary !== null, 'missing successful summary');
    return { start, end };
}
function runState(run: Row, now: number): Range {
    check(['collect', 'discover'].includes(run.command), 'unsupported run command');
    check(['running', 'failed', 'succeeded'].includes(run.status), 'unsupported run status');
    const start = ordered(run.started, 0, now);
    if (run.status !== 'running')
        return terminalRun(run, start, now);
    check(run.finished === null && run.summary === null && run.error === null, 'invalid interrupted run');
    return { start, end: now };
}
function identity(run: Row, o: Row, label: string) {
    if (label === 'robots')
        return { url: robots, kind: 'text' };
    if (run.command === 'collect') {
        check(label === 'csv', 'unsupported collect label');
        return { url: file(o.fiscalYear), kind: 'file' };
    }
    check(/^head:[1-9]\d*$/.test(label), 'unsupported discovery label');
    const year = Number(label.slice(5));
    check(o.years.includes(year), 'unselected candidate');
    return { url: file(year), kind: 'json' };
}
function transportFailure(a: Row) {
    check(typeof a.error === 'string' && a.error.length > 0, 'missing transport failure');
    check(equal(headers(JSON.parse(a.headers)), {}), 'unknown transport HTTP context');
}
function responseError(a: Row) {
    if (a.status >= 400 || /^HTTP \d+$/.test(a.error ?? ''))
        check(a.error === `HTTP ${a.status}`, 'HTTP outcome mismatch');
    if (a.status !== 200)
        check(a.error !== null || a.status === 302, 'unknown HTTP context');
}
function httpOutcome(a: Row) {
    if (a.status === null)
        return transportFailure(a);
    check(Number.isInteger(a.status) && a.status >= 100 && a.status <= 599, 'invalid HTTP outcome');
    headers(JSON.parse(a.headers));
    responseError(a);
}
function attemptState(a: Row, run: Row, o: Row, range: Range) {
    check(a.url === identity(run, o, a.label).url, 'attempt source identity mismatch');
    const start = ordered(a.started, range.start, range.end);
    check(Number.isSafeInteger(a.bytes) && a.bytes >= 0, 'invalid attempt accounting');
    if (a.finished === null) {
        check(run.status === 'running', 'unfinished terminal attempt');
        return;
    }
    ordered(a.finished, start, range.end);
    httpOutcome(a);
}
function rawObservation(root: string, o: Row, a: Row) {
    check(o.path === a.id + '.body', 'observation path identity mismatch');
    const path = join(root, o.path), actual = existsSync(path) ? path : path + '.pending';
    privateFile(actual);
    const raw = readFileSync(actual);
    check(raw.length === o.bytes && createHash('sha256').update(raw).digest('hex') === o.sha256, 'ledger original checksum mismatch');
    return raw;
}
function observationAttempt(o: Row, a: Row | undefined) {
    check(a && a.run === o.run && a.label === o.label && a.url === o.url, 'observation attempt mismatch');
    check(a.status === 200 && a.error === null && a.finished !== null && a.bytes === o.bytes, 'observation outcome mismatch');
    return a;
}
function observationClock(o: Row, facts: ClockFacts) {
    const bound = facts.observations.get(o.run + '\0' + o.label);
    check(bound && bound.domain === facts.domain, 'independent observation timing unavailable: operator review required');
    check(ordered(o.retrieved,bound.lowerMs,bound.upperMs) === bound.retrievedMs, 'observation provider-clock mismatch');
    return bound;
}
function observationWall(o: Row, a: Row, facts: ClockFacts) {
    const bound = observationClock(o,facts);
    check(bound.wallMs >= timestamp(a.started) && bound.wallMs <= timestamp(a.finished), 'checkpoint wall mapping outside attempt interval');
}
function observationState(root: string, o: Row, attempt: Row | undefined, run: Row, options: Row, facts: ClockFacts) {
    const a = observationAttempt(o, attempt);
    check(o.kind === identity(run, options, o.label).kind, 'observation kind mismatch');
    check(['pending', 'ready'].includes(o.status), 'observation status mismatch');
    observationWall(o,a,facts);
    const cap = o.kind === 'file' ? options.budget.zipBytes : options.budget.responseBytes;
    check(o.bytes <= cap, 'observation exceeds persisted file bound');
    const raw = rawObservation(root, o, a);
    if (o.kind !== 'json')
        return undefined;
    return metadataCandidate(Number(o.label.slice(5)), JSON.parse(raw.toString()), JSON.parse(a.headers));
}
function discoveryCandidate(year: number, attempts: Row[], candidates: Map<string, unknown>) {
    const label = `head:${year}`, a = attempts.find(a => a.label === label);
    check(a, 'missing candidate attempt');
    if ([404, 410].includes(a.status))
        return { fiscalYear: year, status: 'unavailable', contentValidated: false };
    check(candidates.has(label), 'missing candidate metadata');
    return candidates.get(label);
}
function discoverySummary(run: Row, o: Row, attempts: Row[], candidates: Map<string, unknown>) {
    if (run.status !== 'succeeded')
        return;
    const expected = o.years.map((year: number) => discoveryCandidate(year, attempts, candidates));
    const summary = object(JSON.parse(run.summary));
    exactKeys(summary, ['catalog', 'completeHistory', 'candidates']);
    check(summary.catalog === 'caller_bounded_candidates' && summary.completeHistory === false, 'invalid discovery summary');
    check(equal(summary.candidates, expected), 'candidate summary mismatch');
}
function previousImportStart(run: Row, receipt: Row) {
    if (run.command !== 'collect' || run.status !== 'succeeded') return Infinity;
    const prior = object(JSON.parse(run.summary));
    if (prior.fileSHA256 !== receipt.fileSHA256 || prior.importedAt !== receipt.importedAt || prior.output !== receipt.output) return Infinity;
    return timestamp(run.started);
}
function importTime(run: Row, receipt: Row, runs: Row[]) {
    if (Object.hasOwn(receipt,'importReused')) check(receipt.importReused === true, 'invalid import reuse provenance');
    const earliest = Math.min(timestamp(run.started), ...runs.map(r=>previousImportStart(r,receipt)));
    // Rebinding a preexisting v1 batch preserves its timestamp: it is not a new
    // import event. Validate it against the actual batch, never invent history.
    const low = receipt.importReused === true ? 0 : earliest;
    ordered(receipt.importedAt,low,timestamp(run.finished));
}
function collectSummary(run: Row, o: Row, runs: Row[]) {
    if (run.status !== 'succeeded')
        return;
    const receipt = object(JSON.parse(run.summary));
    exactKeys(receipt, ['fileSHA256', 'fiscalYear', 'importedAt', 'bytes', 'status', 'rowsRead', 'accepted', 'rejected', 'sourceURL', 'acquisitionURL', 'output', 'run', 'importReused']);
    check(receipt.run === run.id && receipt.fiscalYear === o.fiscalYear && receipt.acquisitionURL === file(o.fiscalYear), 'binding identity mismatch');
    check(receipt.sourceURL === sourceURL, 'binding source mismatch');
    check(receipt.rowsRead <= o.budget.records && receipt.bytes <= o.budget.zipBytes, 'binding exceeds persisted bounds');
    importTime(run,receipt,runs);
}
function artifacts(root: string, attempts: Row[]) {
    const known = new Set(attempts.flatMap(a => ['.body', '.body.pending', '.body.part'].map(s => a.id + s)));
    for (const name of readdirSync(root))
        if (name.includes('.body'))
            check(known.has(name), 'orphan original');
}
function sourceIdentity(s: Row) {
    check(s.original_url === sourceURL, 'source identity mismatch');
    if (s.id === 'financial:candidates')
        return;
    check(/^financial:[1-9]\d*$/.test(s.id), 'unsupported source identity');
    positiveInteger(Number(s.id.slice('financial:'.length)));
}
function references(ledger: Ledger) {
    for (const source of ledger.sources)
        sourceIdentity(source);
    const ids = new Set(ledger.runs.map(r => r.id));
    for (const row of [...ledger.options, ...ledger.attempts, ...ledger.observations])
        check(ids.has(row.run), 'orphan ledger entry');
    const sources = new Set(ledger.sources.map(s => s.id));
    for (const run of ledger.runs)
        check(sources.has(run.source), 'orphan source');
}
function bodyCeilingFailure(run: Row, own: Row[]) {
    const last = own.at(-1);
    return run.status === 'failed' && last?.finished !== null && last?.error === 'response byte ceiling exceeded';
}
function accounting(run: Row, own: Row[], o: Row) {
    check(own.length <= o.budget.requests, 'run request accounting mismatch');
    check(new Set(own.map(a => a.label)).size === own.length, 'duplicate financial attempt');
    const used = own.reduce((n, a) => n + a.bytes, 0);
    check(Number.isSafeInteger(used), 'invalid aggregate accounting');
    // A bounded reader can receive one over-limit chunk, charge it and fail.
    // Preserve that explicit producer failure, not arbitrary over-budget history.
    if (!bodyCeilingFailure(run,own))
        check(used <= o.budget.totalBytes, 'run body accounting mismatch');
}
function producerObservations(own: Row[], observations: Row[]) {
    for (const a of own) {
        if (a.status !== 200 || a.error !== null || a.finished === null)
            continue;
        check(observations.some(o => o.path === a.id + '.body'), 'successful response missing observation');
    }
}
function attemptSequence(attempts: Row[]) {
    let previous: Row | undefined;
    for (const a of attempts) {
        if (previous) {
            check(previous.finished !== null, 'attempt after interrupted producer');
            ordered(a.started, timestamp(previous.finished), Date.now());
        }
        previous = a;
    }
}
function validateRun(root: string, run: Row, ledger: Ledger, facts: ClockFacts) {
    const range = runState(run, Date.now()), o = optionsFor(run, ledger.options.find(o => o.run === run.id));
    const own = ledger.attempts.filter(a => a.run === run.id), observations = ledger.observations.filter(o => o.run === run.id);
    accounting(run, own, o);
    for (const a of own)
        attemptState(a, run, o, range);
    producerObservations(own, observations);
    const candidates = new Map<string, unknown>();
    for (const obs of observations) {
        const candidate = observationState(root, obs, own.find(a => obs.path === a.id + '.body'), run, o, facts);
        if (candidate)
            candidates.set(obs.label, candidate);
    }
    if (run.command === 'discover')
        discoverySummary(run, o, own, candidates);
    else
        collectSummary(run, o, ledger.runs);
}
function versionTimes(ledger: Ledger, facts: ClockFacts) {
    for (const v of ledger.versions) {
        const o = ledger.observations.find(o => o.path === v.path);
        check(o, 'orphan version');
        check(v.first_retrieved === o.retrieved, 'version retrieval mismatch');
        const bound = observationClock(o,facts);
        ordered(v.first_retrieved,bound.lowerMs,bound.upperMs);
    }
}
function independentClocks(db: Database) {
    const gate = rows(db,'cooldown');
    check(gate.length === 1 && gate[0].id === 1, 'invalid cooldown singleton: operator review required');
    const value = gate[0].not_before;
    check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER, 'invalid cooldown/manual stop: operator review required');
    // The mutable gate is policy, NEVER an observation-time ceiling.
    return validateTiming(db,value);
}
// Never call Archive.read/verify, recover, setSpacing or any writer here.
export function validateSourceLedger(db: Database, root: string) {
    const ledger: Ledger = { runs: rows(db, 'runs'), attempts: rows(db, 'attempts'), observations: rows(db, 'observations'), options: rows(db, 'acquisition_options'), versions: rows(db, 'versions'), sources: rows(db, 'sources') };
    artifacts(root, ledger.attempts);
    references(ledger);
    attemptSequence(ledger.attempts);
    const facts = independentClocks(db);
    for (const run of ledger.runs)
        validateRun(root, run, ledger, facts);
    versionTimes(ledger, facts);
}
