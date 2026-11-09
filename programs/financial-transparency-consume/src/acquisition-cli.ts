import { parseArgs } from 'node:util';
import { collect, discover, verifyAcquisition, UnsupportedSource } from './acquisition';
import type { Dependencies } from '../../arcgis-consume/src/archive';
import { decimalInteger as integer } from './model';
import { ensure } from './acquisition-options';
export const acquisitionHelp = 'discover --source-archive PRIVATE_SOURCE (--fiscal-year YEAR | --first-year YEAR --last-year YEAR) [budgets] [--refresh]\ncollect (or acquire) --source-archive PRIVATE_SOURCE --output PRIVATE_IMPORT --fiscal-year YEAR [budgets] [--refresh]\nverify-source --source-archive PRIVATE_SOURCE --output PRIVATE_IMPORT\nBudgets: --max-requests N (10), --max-bytes N (104857600 per file), --max-total-bytes N (209715200 consumed bodies per run), --max-rows N (1000000). Positive safe decimal integers. Retries=0; redirects=0; spacing>=3 seconds plus server/policy cooldown. Discovery is caller-bounded HEAD candidates, not a complete history or content validation. Refresh requests a new snapshot; default reuse and verify-source make zero HTTP requests.';
const stringOptions = ['source-archive', 'output', 'fiscal-year', 'first-year', 'last-year', 'max-requests', 'max-bytes', 'max-total-bytes', 'max-rows'];
type Values = Record<string, string | boolean | undefined>;
type Command = {
    command: string;
    values: Values;
    names: string[];
};
function text(values: Values, key: string, fallback = '') {
    const value = values[key];
    return value === undefined ? fallback : value as string;
}
function safeResult(value: object) {
    const keys = ['integrity', 'bindings', 'httpRequests', 'catalog', 'completeHistory', 'candidates', 'fileSHA256', 'fiscalYear', 'bytes', 'status', 'rowsRead', 'accepted', 'rejected', 'reused'];
    return Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key)));
}
function parseCommand(args: string[]): Command {
    const { values, positionals, tokens } = parseArgs({ args, tokens: true, allowPositionals: true, strict: true, options: Object.fromEntries([
            ...stringOptions.map(name => [name, { type: 'string' as const }]), ['refresh', { type: 'boolean' as const }],
        ]) });
    const names = tokens.filter(token => token.kind === 'option').map(token => token.name);
    const parsed = values as Values;
    ensure(new Set(names).size === names.length && positionals.length === 1 && parsed['source-archive'], 'usage');
    for (const key of stringOptions.filter(key => !['source-archive', 'output'].includes(key))) {
        if (parsed[key] !== undefined)
            integer(text(parsed, key));
    }
    return { command: positionals[0]!, values: parsed, names };
}
function common(values: Values) {
    return {
        sourceArchive: text(values, 'source-archive'), refresh: values.refresh as boolean | undefined,
        maxRequests: integer(text(values, 'max-requests', '10')), maxBytes: integer(text(values, 'max-bytes', '104857600')),
        maxTotalBytes: integer(text(values, 'max-total-bytes', '209715200')), maxRows: integer(text(values, 'max-rows', '1000000')),
    };
}
function candidateYears(values: Values, maximum: number) {
    if (values['fiscal-year']) {
        ensure(!values['first-year'] && !values['last-year'], 'usage');
        return [integer(text(values, 'fiscal-year'))];
    }
    const first = integer(text(values, 'first-year')), last = integer(text(values, 'last-year'));
    ensure(last >= first && last - first < maximum, 'candidate bounds');
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
function verifyCommand({ values, names }: Command) {
    ensure(values.output && names.every(name => ['source-archive', 'output'].includes(name)), 'usage');
    return verifyAcquisition(text(values, 'source-archive'), text(values, 'output'));
}
function discoverCommand({ values }: Command, dependencies: Partial<Dependencies>) {
    ensure(!values.output, 'usage');
    const options = common(values);
    return discover({ ...options, years: candidateYears(values, options.maxRequests) }, dependencies);
}
function collectCommand({ command, values }: Command, dependencies: Partial<Dependencies>) {
    ensure(['collect', 'acquire'].includes(command) && values.output && values['fiscal-year'], 'usage');
    ensure(!values['first-year'] && !values['last-year'], 'usage');
    return collect({ ...common(values), output: text(values, 'output'), fiscalYear: integer(text(values, 'fiscal-year')) }, dependencies);
}
async function dispatch(plan: Command, dependencies: Partial<Dependencies>) {
    if (plan.command === 'verify-source')
        return verifyCommand(plan);
    if (plan.command === 'discover')
        return discoverCommand(plan, dependencies);
    return collectCommand(plan, dependencies);
}
function resultExit(result: Record<string, unknown>) {
    if (result.status === 'unavailable')
        return 3;
    return result.rejected ? 2 : 0;
}
function errorResult(error: unknown, write: (text: string) => void) {
    if (error instanceof UnsupportedSource) {
        write(JSON.stringify({ status: 'unsupported' }));
        return 4;
    }
    write(JSON.stringify({ error: 'operation_failed' }));
    return 1;
}
export async function runAcquisitionCli(args: string[], write: (text: string) => void = console.log, dependencies: Partial<Dependencies> = {}): Promise<number> {
    try {
        const safe = safeResult(await dispatch(parseCommand(args), dependencies));
        write(JSON.stringify(safe));
        return resultExit(safe);
    }
    catch (error) {
        return errorResult(error, write);
    }
}
