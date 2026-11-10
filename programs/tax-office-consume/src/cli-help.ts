import type {Commands} from './frontend';
const DESCRIPTIONS:Record<string,[string,string]>={
 "list": [
  "[--output ROOT]",
  "List retained catalog IDs, or describe legacy delinquency without --output"
 ],
 "import": [
  "--output ROOT --selection delinquency --max-rows N --csv FILE --layout PDF [--max-bytes BYTES] [--refresh]",
  "Import semantic delinquency from retained originals"
 ],
 "collect": [
  "--output ROOT --selection ID [--max-rows N] [BUDGETS] [--catalog-version HASH] [--version HASH] [--refresh]",
  "Collect exact catalog ID (raw) or delinquency (semantic; requires --max-rows)"
 ],
 "status": [
  "--output ROOT",
  "Inspect retained archive status"
 ],
 "verify": [
  "--output ROOT",
  "Verify retained archive offline"
 ],
 "discover": [
  "--output ROOT [BUDGETS]",
  "Fetch published export catalog metadata explicitly"
 ],
 "catalog-import": [
  "--output ROOT --html FILE",
  "Import retained catalog HTML offline"
 ],
 "import-export": [
  "--output ROOT --selection ID --file FILE [--layout FILE] [--catalog-version HASH] [BUDGETS]",
  "Import raw original for an exact retained catalog item"
 ]
};
const NOTES:Record<string,string>={
 "list": "No --output: historical delinquency adapter description. With --output: offline retained published catalog IDs and observations. Run discover or catalog-import first.",
 "collect": "--selection delinquency requires explicit --max-rows (positive decimal safe integer). Generic export defaults: 512 MiB/artifact, 1 GiB work, 12 requests, 1000000 row budget (raw rows remain null). Legacy delinquency defaults: 4 MiB CSV, 16 MiB work, 8 requests. --version HASH and --catalog-version HASH select retained observations/catalogs, not the program version. Bare --refresh requests a new observation; omission means false. --version and --refresh conflict. No guessed historical URLs.",
 "discover": "Generic defaults: 512 MiB/artifact, 1 GiB work, 12 requests and 1000000 row budget. All explicit budgets are positive decimal safe integers. Metadata acquisition is explicit; catalog-import is offline.",
 "import": "--selection must be delinquency; --max-rows is required, with no implicit first-N success. --max-bytes defaults to 4 MiB. Bare --refresh starts a new observation after validating prior evidence; omission means false.",
 "import-export": "Exact retained catalog ID required. Layout is required only when paired in the catalog. Raw-original profile retains bytes; it does not claim semantic parsing. Generic default bounds: 512 MiB/artifact, 1 GiB work, 12 requests, 1000000 row budget."
};
export function commandHelp(options:Record<string,string[]>):Commands {
 return Object.fromEntries(Object.entries(options).map(([key,value])=>[key,{usage:DESCRIPTIONS[key]![0],description:DESCRIPTIONS[key]![1],notes:NOTES[key],options:value,flags:['import','collect'].includes(key)?['--refresh']:[]}]));
}
export const EXAMPLES="  tax-office-consume catalog-import --html \"$HTML\" --output \"$ROOT\"\n  tax-office-consume list --output \"$ROOT\"\n  tax-office-consume help import-export\n  tax-office-consume help collect\n  BUDGETS: --max-bytes N --max-rows N --max-requests N --max-total-bytes N\n  collect --version HASH selects retained export bytes; it is NOT program version.";
