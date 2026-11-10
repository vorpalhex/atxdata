import type {Commands} from './frontend';
const DESCRIPTIONS:Record<string,[string,string]>={
 "list": [
  "",
  "Describe the legacy pinned first25 selection"
 ],
 "import": [
  "--archive ZIP --layout ZIP --selection ID --rows 25 --output ROOT",
  "Import the legacy pinned first25 Property selection"
 ],
 "inventory": [
  "--archive ZIP --selection ID",
  "Inspect the legacy pinned ZIP metadata"
 ],
 "integrity": [
  "--archive ZIP --selection ID --max-expanded BYTES --max-seconds SECONDS",
  "Check the legacy pinned ZIP within explicit total/time ceilings"
 ],
 "status": [
  "--output ROOT",
  "Inspect legacy import status"
 ],
 "verify": [
  "--output ROOT",
  "Verify legacy retained selections offline"
 ],
 "import-member": [
  "--archive ZIP --snapshot LABEL --member NAME --start N --count N|all --max-expanded BYTES --max-seconds SECONDS --output ROOT [--layout ZIP]",
  "Import an explicit general member range"
 ],
 "verify-members": [
  "--output ROOT",
  "Verify general retained member versions offline"
 ],
 "member-status": [
  "--output ROOT",
  "Inspect general member versions, including incomplete work"
 ],
 "layouts": [
  "--layout ZIP",
  "Enumerate general workbook schemas"
 ],
 "inventory-members": [
  "--archive ZIP",
  "Discover exact general ZIP member names"
 ],
 "discover": [
  "--output ROOT --max-requests N --max-bytes BYTES",
  "Fetch official published ZIP catalog metadata explicitly"
 ],
 "acquire": [
  "--output ROOT --id ID --max-requests N --max-bytes BYTES [--refresh true|false]",
  "Retain an exact catalog ID, without importing its members"
 ],
 "catalog": [
  "--output ROOT",
  "List general catalog IDs offline"
 ],
 "catalog-import": [
  "--output ROOT --html FILE",
  "Import retained catalog HTML offline (not live discovery)"
 ]
};
const NOTES:Record<string,string>={
 "list": "Legacy selection: 2026-certified-supp0-property-first25; exactly 25 Property records. Use catalog and inventory-members for general discovery.",
 "import-member": "--start defaults: none (required, one-based). --count is a positive safe integer or all. All budgets are explicit positive safe integers, including Number-compatible syntax (e.g. 1e2). The start+count sum must be safe. --layout is optional; missing schemas remain raw, not interpreted. Completed coverage requires start=1, count=all and EOF.",
 "integrity": "--max-expanded: 1..21474836480 bytes; --max-seconds: 1..900 seconds. Legacy pinned identity only; no implicit full-roll pass.",
 "acquire": "Explicit positive safe --max-requests and --max-bytes are required, including cache hits. --refresh requires true or false; default false verifies/reuses retained bytes without requesting freshness. Exact catalog ID only; no guessed URLs.",
 "discover": "Explicit positive safe --max-requests and --max-bytes are required. Network metadata only; use catalog-import for offline retained HTML."
};
export function commandHelp(options:Record<string,string[]>):Commands {
 return Object.fromEntries(Object.entries(options).map(([key,value])=>[key,{usage:DESCRIPTIONS[key]![0],description:DESCRIPTIONS[key]![1],notes:NOTES[key],options:value}]));
}
export const EXAMPLES="  tcad-consume catalog-import --html \"$HTML\" --output \"$ROOT\"\n  tcad-consume catalog --output \"$ROOT\"\n  tcad-consume inventory-members --archive \"$ZIP\"\n  tcad-consume help import-member\n  tcad-consume help acquire";
