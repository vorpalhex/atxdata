import { validateRunOptions } from '../../arcgis-consume/src/policy';
import { positiveInteger } from './model';
export type AcquisitionOptions = {
    sourceArchive: string;
    output: string;
    fiscalYear: number;
    refresh?: boolean;
    maxRequests?: number;
    maxBytes?: number;
    maxTotalBytes?: number;
    maxRows?: number;
};
export type DiscoveryOptions = Omit<AcquisitionOptions, 'output' | 'fiscalYear'> & {
    years: number[];
};
export function unavailable(status: unknown) { return status === 404 || status === 410; }
export function ensure(value: unknown, message: string): asserts value {
    if (!value)
        throw new Error(message);
}
export function object(value: unknown): Record<string, any> {
    ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid options object');
    return value as Record<string, any>;
}
export function exactKeys(value: object, keys: readonly string[]) {
    ensure(Object.keys(value).every(key => keys.includes(key)), 'unknown options field');
}
function optional(value: unknown, validate: (value: any) => unknown) {
    if (value !== undefined)
        validate(value);
}
function pathOption(value: unknown) {
    ensure(typeof value === 'string' && value.startsWith('/'), 'absolute archive path required');
}
const controls = ['maxRequests', 'maxBytes', 'maxTotalBytes', 'maxRows'];
export function runtimeOptions(value: unknown, discovery = false) {
    const o = object(value);
    // Legacy structural callers may pass output/fiscalYear to discovery. Validate,
    // but do not treat these context fields as a second candidate selection.
    exactKeys(o, ['sourceArchive', 'output', 'fiscalYear', 'years', 'refresh', ...controls]);
    pathOption(o.sourceArchive);
    optional(o.refresh, value => ensure(typeof value === 'boolean', 'invalid refresh'));
    for (const key of controls)
        optional(o[key], positiveInteger);
    if (discovery) {
        validateYears(o.years, budget(o as AcquisitionOptions).requests);
        optional(o.output, pathOption);
        optional(o.fiscalYear, positiveInteger);
    }
    else {
        pathOption(o.output);
        positiveInteger(o.fiscalYear);
        ensure(!Object.hasOwn(o, 'years'), 'unexpected candidate selection');
    }
}
export function validateYears(years: unknown, maximum: number): asserts years is number[] {
    ensure(Array.isArray(years) && years.length > 0 && years.length <= maximum, 'explicit bounded candidates required');
    ensure(Object.keys(years).length === years.length, 'sparse candidate selection');
    for (const year of years)
        positiveInteger(year);
    ensure(new Set(years).size === years.length, 'duplicate candidate');
}
export function budget(options: AcquisitionOptions) {
    return {
        requests: positiveInteger(options.maxRequests ?? 10),
        responseBytes: positiveInteger(options.maxBytes ?? 104857600),
        zipBytes: positiveInteger(options.maxBytes ?? 104857600),
        totalBytes: positiveInteger(options.maxTotalBytes ?? 209715200),
        records: positiveInteger(options.maxRows ?? 1000000),
        retries: 0,
    };
}
export function persistedOptions(value: unknown, discovery: boolean) {
    const o = object(validateRunOptions(value));
    exactKeys(o, discovery ? ['years', 'budget'] : ['fiscalYear', 'budget']);
    const b = object(o.budget);
    exactKeys(b, ['requests', 'responseBytes', 'zipBytes', 'totalBytes', 'records', 'retries']);
    for (const key of ['requests', 'responseBytes', 'zipBytes', 'totalBytes', 'records'])
        positiveInteger(b[key]);
    ensure(b.retries === 0 && b.responseBytes === b.zipBytes, 'unsupported financial budget');
    if (discovery)
        validateYears(o.years, b.requests);
    else
        positiveInteger(o.fiscalYear);
    return o;
}
