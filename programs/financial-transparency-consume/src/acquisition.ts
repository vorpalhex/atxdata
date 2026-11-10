import { readonlySource } from "./readonly-source";
import { validateSourceSchema } from "./source-schema";
import { budget, runtimeOptions, unavailable, ensure, type AcquisitionOptions, type DiscoveryOptions } from "./acquisition-options";
export { budget, type AcquisitionOptions, type DiscoveryOptions } from "./acquisition-options";
import { validateRunOptions } from "../../arcgis-consume/src/policy";
import { validateSourceLedger, metadataCandidate } from "./source-ledger";
import { preflightImportBindings } from "./source-bindings";
import { Archive, type Dependencies } from "../../arcgis-consume/src/archive";
import { archivePath, privateFile, withLock } from "./archive";
import { existsSync, readdirSync, chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decode } from "./csv";
import { positiveInteger, sourceURL, type Batch } from "./model";
import { importCsv } from "./importer";
import { verifyArchive, verifyDatabase } from "./verify";
import { openStore } from "./store";
export const origin = "https://tctransparency.traviscountytx.gov";
const robotsURL = origin + "/robots.txt";
export const fileURL = (year: number) => `${origin}/Reports/DataSAP/PaymentRegister_${positiveInteger(year)}.csv`;
type Binding = Batch & {
    importReused?: true;
    acquisitionURL: string;
    output: string;
    run: string;
};
export class UnsupportedSource extends Error {
}
let active = false;
function preflight(root: string) {
    archivePath(root);
    for (const name of readdirSync(root)) {
        ensure(/^(state\.sqlite(?:-wal|-shm)?|[a-f0-9-]{36}\.body(?:\.pending|\.part)?)$/.test(name), "unknown artifact or locked archive");
        privateFile(join(root, name));
    }
    const path = join(root, "state.sqlite");
    if (!existsSync(path)) ensure(readdirSync(root).length === 0, 'orphan source archive evidence');
    if (existsSync(path)) {
        const db = readonlySource(path);
        try {
            validateSourceSchema(db);
            validateSourceLedger(db, root);
            preflightImportBindings(db);
        }
        finally {
            db.close();
        }
    }
}
async function usingArchive<T>(root: string, dependencies: Partial<Dependencies>, action: (archive: Archive) => Promise<T>, schedule = true): Promise<T> {
    ensure(!active, "one financial acquisition writer required");
    active = true;
    const mask = process.umask(0o077);
    let archive: Archive | undefined;
    try {
        preflight(root);
        if (!existsSync(join(root, "state.sqlite")))
            writeFileSync(join(root, "state.sqlite"), "", {
                flag: "wx",
                mode: 0o600,
            });
        archive = await Archive.open(root, dependencies);
        archive.guard = (url) => ensure(url === robotsURL ||
            /^https:\/\/tctransparency\.traviscountytx\.gov\/Reports\/DataSAP\/PaymentRegister_[1-9]\d*\.csv$/.test(url), "unsupported URL");
        // Offline verification must not create scheduling facts in a reader's
        // different clock domain. Policy/manual-stop validation still applies.
        if (schedule) archive.setSpacing(3000);
        return await action(archive);
    }
    finally {
        try {
            await archive?.close();
        }
        finally {
            process.umask(mask);
            active = false;
        }
    }
}
function validateCSV(value: unknown, year: number, rows: number) {
    ensure(Buffer.isBuffer(value), "expected raw bytes");
    const decoded = (() => {
        try {
            return decode(value, year);
        }
        catch {
            throw new UnsupportedSource("unsupported source contract");
        }
    })();
    if (decoded.length === 0)
        throw new UnsupportedSource("source year unverified");
    ensure(decoded.length <= rows, "row limit");
    // Validate source selection independently of the importer's first-reason quarantine.
    if (!decoded.every((row) => row.fields[0] === String(year)))
        throw new UnsupportedSource("source year mismatch");
    return decoded;
}
function bindings(archive: Archive): Binding[] {
    return archive.store.db
        .query<{
        id: string;
        source: string;
        summary: string;
    }, [
    ]>("SELECT id,source,summary FROM runs WHERE command='collect' AND status='succeeded' ORDER BY rowid")
        .all()
        .map((row) => {
        const receipt = JSON.parse(row.summary) as Binding;
        ensure(receipt.run === row.id &&
            row.source === `financial:${receipt.fiscalYear}`, "receipt run identity mismatch");
        return receipt;
    });
}
function verifyRunCommands(archive: Archive) {
    const runs = archive.store.db
        .query<{
        source: string;
        command: string;
        status: string;
        summary: string | null;
    }, [
    ]>("SELECT source,command,status,summary FROM runs")
        .all();
    for (const run of runs) {
        const expected = run.source === "financial:candidates" ? "discover" : "collect";
        ensure(run.command === expected, "unsupported run command");
        if (run.command === "collect" && run.summary !== null)
            ensure(run.status === "succeeded", "inconsistent bound run status");
    }
    for (const source of archive.store.db
        .query<{
        original_url: string;
    }, [
    ]>("SELECT original_url FROM sources")
        .all())
        ensure(source.original_url === sourceURL, "source identity mismatch");
}
function verifyObservationAttempt(archive: Archive, observation: ReturnType<Archive["store"]["observations"]>[number]) {
    const attempt = archive.store.db
        .query<{
        run: string;
        label: string;
        url: string;
        status: number;
        finished: string | null;
        error: string | null;
        bytes: number;
    }, [
        string
    ]>("SELECT run,label,url,status,finished,error,bytes FROM attempts WHERE id=?")
        .get(observation.path.replace(/\.body$/, ""));
    ensure(attempt &&
        attempt.run === observation.run &&
        attempt.label === observation.label &&
        attempt.url === observation.url &&
        attempt.status === 200 &&
        attempt.finished &&
        attempt.error === null &&
        attempt.bytes === observation.bytes, "observation attempt mismatch");
}
function verifyBodyArtifacts(archive: Archive) {
    const attempts = archive.store.db
        .query<{
        id: string;
    }, [
    ]>("SELECT id FROM attempts")
        .all();
    const known = new Set(attempts.flatMap((row) => [
        row.id + ".body",
        row.id + ".body.pending",
        row.id + ".body.part",
    ]));
    for (const name of readdirSync(archive.root)) {
        if (/\.body/.test(name))
            ensure(known.has(name), "orphan original");
        privateFile(join(archive.root, name));
    }
}
function verifyImportedReceipt(receipt: Binding, importOutput: string) {
    withLock(importOutput, () => {
        const db = openStore(importOutput, false);
        try {
            verifyDatabase(db, importOutput);
            const batch = db
                .query<Batch, [
                string
            ]>("SELECT * FROM batches WHERE fileSHA256=?")
                .get(receipt.fileSHA256);
            ensure(batch, "missing bound batch");
            for (const key of Object.keys(batch) as (keyof Batch)[])
                ensure(batch[key] === receipt[key], "binding import mismatch");
        }
        finally {
            db.close();
        }
    });
}
async function verifyReceipt(archive: Archive, receipt: Binding, output?: string) {
    const options = archive.store.options(receipt.run);
    const importOutput = output ?? receipt.output;
    archivePath(importOutput);
    ensure(options?.fiscalYear === receipt.fiscalYear &&
        receipt.acquisitionURL === fileURL(receipt.fiscalYear) &&
        receipt.output === importOutput, "binding selection mismatch");
    const observation = archive.store.observation(receipt.run, "csv");
    ensure(observation?.url === receipt.acquisitionURL &&
        observation.kind === "file" &&
        observation.sha256 === receipt.fileSHA256 &&
        observation.bytes === receipt.bytes, "binding original mismatch");
    const raw = await archive.read(receipt.run, "csv");
    validateCSV(raw, receipt.fiscalYear, Number.MAX_SAFE_INTEGER);
    verifyImportedReceipt(receipt, importOutput);
}
async function verifyBindings(archive: Archive, output?: string) {
    verifyRunCommands(archive);
    for (const observation of archive.store.observations())
        verifyObservationAttempt(archive, observation);
    await archive.verify();
    verifyBodyArtifacts(archive);
    const receipts = bindings(archive);
    for (const receipt of receipts)
        await verifyReceipt(archive, receipt, output);
    return receipts;
}
function requireHTTP200(archive: Archive, run: string, label: string) {
    const attempt = archive.store.db.query<{status:number|null},[string,string]>(
        'SELECT status FROM attempts WHERE run=? AND label=? ORDER BY rowid DESC LIMIT 1'
    ).get(run,label);
    if (attempt?.status !== 200) throw new UnsupportedSource('unsupported source status');
}
async function policyText(archive: Archive, run: string) {
    const prior = archive.store.db
        .query<{
        run: string;
        status: number | null;
    }, [
        string
    ]>("SELECT run,status FROM attempts WHERE url=? ORDER BY rowid DESC LIMIT 1")
        .get(robotsURL);
    if (unavailable(prior?.status))
        return undefined;
    let text: unknown;
    if (prior) {
        ensure(prior.status === 200 && archive.store.observation(prior.run, "robots"), "cached policy failure: manual review required");
        text = await archive.read(prior.run, "robots");
    }
    else {
        try {
            text = await archive.request(run, "robots", robotsURL, "text", () => requireHTTP200(archive,run,'robots'));
        }
        catch (error) {
            const outcome = archive.store.db
                .query<{
                status: number | null;
            }, [
                string
            ]>("SELECT status FROM attempts WHERE run=? AND label='robots' ORDER BY rowid DESC LIMIT 1")
                .get(run);
            if (unavailable(outcome?.status))
                return undefined;
            throw error;
        }
    }
    return text;
}
function applyPolicy(archive: Archive, text: unknown) {
    ensure(typeof text === "string" && !/<(?:html|!doctype)/i.test(text), "unsupported policy/challenge");
    // Conservative policy: any nonempty disallow (including another agent group)
    // requires manual review. Never silently discard restrictive directives.
    for (const line of text.split(/\r?\n/)) {
        const clean = line.split("#")[0].trim();
        ensure(!/^disallow\s*:\s*\S/i.test(clean), "robots restriction requires review");
        if (/^crawl-delay\s*:/i.test(clean)) {
            const delay = Number(clean.split(":").slice(1).join(":"));
            ensure(Number.isFinite(delay) && delay >= 0, "invalid crawl delay");
            archive.setSpacing(Math.max(3000, delay * 1000));
        }
    }
}
async function policy(archive: Archive, run: string) {
    const text = await policyText(archive, run);
    if (text !== undefined)
        applyPolicy(archive, text);
}
type Bounds = ReturnType<typeof budget>;
async function cachedCollection(archive: Archive, options: AcquisitionOptions, bounds: Bounds) {
    const receipts = await verifyBindings(archive, options.output);
    const prior = receipts
        .filter((row) => row.fiscalYear === options.fiscalYear)
        .at(-1);
    if (prior && !options.refresh) {
        ensure(prior.bytes <= bounds.zipBytes && prior.rowsRead <= bounds.records, "reuse exceeds requested bounds");
        return { ...prior, reused: true };
    }
}
function requireSettledAttempts(archive: Archive) {
    ensure(!archive.store.db
        .query("SELECT 1 FROM attempts WHERE finished IS NULL LIMIT 1")
        .get(), "interrupted attempt requires review");
}
function previousCollection(archive: Archive, options: AcquisitionOptions) {
    const source = `financial:${options.fiscalYear}`;
    const previous = archive.store.db
        .query<{
        id: string;
        status: string;
        error: string;
    }, [
        string
    ]>("SELECT id,status,error FROM runs WHERE source=? AND command='collect' ORDER BY rowid DESC LIMIT 1")
        .get(source);
    if (previous && previous.status !== "succeeded" && !options.refresh) {
        const attempt = archive.store.db
            .query<{
            status: number;
            url: string;
            finished: string | null;
        }, [
            string
        ]>("SELECT status,url,finished FROM attempts WHERE run=? AND label='csv' ORDER BY rowid DESC LIMIT 1")
            .get(previous.id);
        if (attempt?.finished &&
            attempt.url === fileURL(options.fiscalYear) &&
            [404, 410].includes(attempt.status))
            return {
                fiscalYear: options.fiscalYear,
                status: "unavailable",
                reused: true,
            };
        if (previous.error === "unsupported_source")
            throw new UnsupportedSource("cached unsupported source");
        throw new Error("previous failed/unknown acquisition: explicit refresh required");
    }
}
async function collectFresh(archive: Archive, options: AcquisitionOptions, bounds: Bounds) {
    const source = `financial:${options.fiscalYear}`;
    archive.store.source(source, "Fiscal-year payment register", sourceURL);
    const run = archive.store.start(source, "collect");
    archive.store.saveOptions(run, {
        fiscalYear: options.fiscalYear,
        budget: bounds,
    });
    try {
        await policy(archive, run);
        const raw = await archive.request(run, "csv", fileURL(options.fiscalYear), "file", (value) => {
            requireHTTP200(archive,run,'csv');
            validateCSV(value, options.fiscalYear, bounds.records);
        });
        if (!Buffer.isBuffer(raw))
            throw new UnsupportedSource("unsupported redirect");
        const observation = archive.store.observation(run, "csv")!;
        chmodSync(join(archive.root, observation.path), 0o400);
        const batch = importCsv({
            file: join(archive.root, observation.path),
            output: options.output,
            fiscalYear: options.fiscalYear,
            maxBytes: bounds.zipBytes,
            maxRows: bounds.records,
        });
        const { reused, ...persisted } = batch;
        const receipt: Binding = {
            ...persisted,
            ...(reused ? { importReused: true as const } : {}),
            acquisitionURL: fileURL(options.fiscalYear),
            output: options.output,
            run,
        };
        archive.store.finish(run, "succeeded", undefined, receipt);
        await verifyBindings(archive, options.output);
        return { ...receipt, reused };
    }
    catch (error) {
        archive.store.finish(run, "failed", error instanceof UnsupportedSource
            ? "unsupported_source"
            : "acquisition_failed");
        const outcome = archive.store.db
            .query<{
            status: number | null;
        }, [
            string
        ]>("SELECT status FROM attempts WHERE run=? AND label='csv' ORDER BY rowid DESC LIMIT 1")
            .get(run);
        if (unavailable(outcome?.status))
            return {
                fiscalYear: options.fiscalYear,
                status: "unavailable",
                reused: false,
            };
        throw error;
    }
}
export async function collect(options: AcquisitionOptions, dependencies: Partial<Dependencies> = {}) {
    runtimeOptions(options);
    const bounds = budget(options);
    positiveInteger(options.fiscalYear);
    validateRunOptions({ fiscalYear: options.fiscalYear, budget: bounds });
    preflight(options.sourceArchive);
    archivePath(options.output);
    ensure(options.output !== options.sourceArchive, "separate archives required");
    if (readdirSync(options.output).length)
        verifyArchive(options.output);
    else
        withLock(options.output, () => { });
    return usingArchive(options.sourceArchive, dependencies, async (archive) => {
        const cached = await cachedCollection(archive, options, bounds);
        if (cached)
            return cached;
        requireSettledAttempts(archive);
        const previous = previousCollection(archive, options);
        if (previous)
            return previous;
        return collectFresh(archive, options, bounds);
    });
}
export async function verifyAcquisition(sourceArchive: string, output: string) {
    archivePath(output);
    return usingArchive(sourceArchive, {}, async (archive) => ({
        integrity: "ok",
        bindings: (await verifyBindings(archive, output)).length,
        httpRequests: 0,
    }), false);
}
type Candidate = {
    fiscalYear: number;
    status: string;
    contentValidated: false;
    declaredBytes?: number;
};
async function candidate(archive: Archive, run: string, year: number): Promise<Candidate> {
    const label = `head:${year}`, url = fileURL(year);
    const attempt = archive.store.db
        .query<{
        status: number | null;
        url: string;
        finished: string | null;
    }, [
        string,
        string
    ]>("SELECT status,url,finished FROM attempts WHERE run=? AND label=? ORDER BY rowid DESC LIMIT 1")
        .get(run, label);
    ensure(attempt?.url === url && attempt.finished, "missing metadata attempt");
    if (unavailable(attempt.status))
        return { fiscalYear: year, status: "unavailable", contentValidated: false };
    ensure(attempt.status === 200, "unknown candidate status");
    const observation = archive.store.observation(run, label);
    ensure(observation?.url === url && observation.kind === "json", "metadata identity mismatch");
    const envelope = (await archive.read(run, label)) as {
        method: string;
        status: number;
        bodyBytes: number;
        headers: Record<string, string>;
    };
    const context = archive.store.db
        .query<{
        headers: string;
    }, [
        string,
        string
    ]>("SELECT headers FROM attempts WHERE run=? AND label=? ORDER BY rowid DESC LIMIT 1").get(run, label)!;
    return metadataCandidate(year, envelope, JSON.parse(context.headers));
}
function headDependencies(dependencies: Partial<Dependencies>) {
    // A HEAD result is archived as a locally authored metadata envelope, never as
    // acquired CSV. Synthetic envelope bytes are conservatively charged to budget.
    const wireFetch = dependencies.fetch ??
        ((url: string, init: RequestInit) => fetch(url, init));
    return {
        ...dependencies,
        fetch: async (url: string, init: RequestInit) => {
            if (url === robotsURL)
                return wireFetch(url, init);
            const response = await wireFetch(url, { ...init, method: "HEAD" });
            const originalHeaders = Object.fromEntries(response.headers);
            await response.body?.cancel();
            const headers = new Headers(response.headers);
            headers.delete("content-length");
            headers.delete("content-encoding");
            if (response.status !== 200)
                return new Response(null, { status: response.status, headers });
            return new Response(JSON.stringify({
                method: "HEAD",
                status: response.status,
                bodyBytes: 0,
                headers: originalHeaders,
            }), { status: 200, headers });
        },
    };
}
async function cachedDiscovery(archive: Archive, options: DiscoveryOptions) {
    await verifyBindings(archive);
    const selection = JSON.stringify(options.years);
    const rows = archive.store.db
        .query<{
        id: string;
        status: string;
    }, [
    ]>("SELECT id,status FROM runs WHERE command='discover' ORDER BY rowid DESC")
        .all();
    const prior = rows.find((row) => JSON.stringify(archive.store.options(row.id)?.years) === selection);
    if (prior && !options.refresh) {
        ensure(prior.status === "succeeded", "cached discovery failure: explicit refresh required");
        const candidates = [];
        for (const year of options.years)
            candidates.push(await candidate(archive, prior.id, year));
        return {
            catalog: "caller_bounded_candidates",
            completeHistory: false,
            candidates,
            reused: true,
        };
    }
}
async function probeCandidate(archive: Archive, run: string, year: number) {
    try {
        await archive.request(run, `head:${year}`, fileURL(year), "json");
    }
    catch (error) {
        const outcome = archive.store.db.query<{
            status: number | null;
        }, [
            string,
            string
        ]>("SELECT status FROM attempts WHERE run=? AND label=? ORDER BY rowid DESC LIMIT 1").get(run, `head:${year}`);
        if (!unavailable(outcome?.status))
            throw error;
    }
    return candidate(archive, run, year);
}
async function discoverFresh(archive: Archive, options: DiscoveryOptions, bounds: Bounds) {
    archive.store.source("financial:candidates", "Caller-bounded fiscal-year candidates", sourceURL);
    const run = archive.store.start("financial:candidates", "discover");
    archive.store.saveOptions(run, { years: options.years, budget: bounds });
    try {
        await policy(archive, run);
        const candidates = [];
        for (const year of options.years)
            candidates.push(await probeCandidate(archive, run, year));
        const result = {
            catalog: "caller_bounded_candidates",
            completeHistory: false,
            candidates,
        };
        archive.store.finish(run, "succeeded", undefined, result);
        return { ...result, reused: false };
    }
    catch (error) {
        archive.store.finish(run, "failed", "discovery_failed");
        throw error;
    }
}
export async function discover(options: DiscoveryOptions, dependencies: Partial<Dependencies> = {}) {
    runtimeOptions(options, true);
    const bounds = budget({ ...options, output: "", fiscalYear: 1 });
    ensure(Array.isArray(options.years) &&
        options.years.length > 0 &&
        options.years.length <= bounds.requests, "explicit bounded candidates required");
    options.years.forEach(positiveInteger);
    ensure(new Set(options.years).size === options.years.length, "duplicate candidate");
    validateRunOptions({ years: options.years, budget: bounds });
    return usingArchive(options.sourceArchive, headDependencies(dependencies), async (archive) => {
        const cached = await cachedDiscovery(archive, options);
        if (cached)
            return cached;
        requireSettledAttempts(archive);
        return discoverFresh(archive, options, bounds);
    });
}
