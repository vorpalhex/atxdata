import {Database} from "bun:sqlite";

const BASE_TABLES=["settings","sources","runs","snapshots","observations","versions","history","attempts","cooldowns"];
const EXTRA_TABLES=["archive_schema","snapshot_metadata","artifact_checkpoints","validation_history","history_receipts","robots","representations","classifier_resolutions","legacy_artifacts"];
const BASE=`
PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL CHECK(schema_version=1));
INSERT OR IGNORE INTO settings VALUES(1,1);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES sources(id),kind TEXT NOT NULL,started TEXT NOT NULL,finished TEXT,status TEXT NOT NULL,error TEXT);
CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES sources(id),url TEXT NOT NULL,sha TEXT NOT NULL,path TEXT NOT NULL,origin TEXT NOT NULL,observed TEXT NOT NULL,run TEXT NOT NULL REFERENCES runs(id));
CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL REFERENCES snapshots(id),source TEXT NOT NULL REFERENCES sources(id),url TEXT NOT NULL,evidence TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','downloaded','failed')),UNIQUE(snapshot,id));
CREATE TABLE IF NOT EXISTS versions(source TEXT NOT NULL REFERENCES sources(id),url TEXT NOT NULL,sha TEXT NOT NULL,bytes INTEGER NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,validation TEXT NOT NULL,PRIMARY KEY(source,url,sha));
CREATE TABLE IF NOT EXISTS history(observation TEXT NOT NULL REFERENCES observations(id),source TEXT NOT NULL,url TEXT NOT NULL,sha TEXT NOT NULL,origin TEXT NOT NULL,observed TEXT NOT NULL,PRIMARY KEY(observation,sha),FOREIGN KEY(source,url,sha) REFERENCES versions(source,url,sha));
CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,run TEXT NOT NULL REFERENCES runs(id),url TEXT NOT NULL,kind TEXT NOT NULL,started INTEGER NOT NULL,ended INTEGER,status INTEGER,reservation INTEGER NOT NULL,bytes INTEGER,sha TEXT,headers TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS cooldowns(id INTEGER PRIMARY KEY CHECK(id=1),not_before INTEGER NOT NULL,blocked TEXT);
INSERT OR IGNORE INTO cooldowns VALUES(1,0,NULL);
`;
const EXTRA=`
CREATE TABLE legacy_artifacts(path TEXT PRIMARY KEY,sha TEXT NOT NULL,bytes INTEGER NOT NULL,evidence TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS robots(origin TEXT PRIMARY KEY,body TEXT NOT NULL,sha TEXT NOT NULL,delay INTEGER NOT NULL,observed INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS representations(attempt TEXT PRIMARY KEY REFERENCES attempts(id),encoding TEXT NOT NULL,representation TEXT NOT NULL,wire_bytes INTEGER,decoded_bytes INTEGER NOT NULL,encoded_hash TEXT,decoded_hash TEXT NOT NULL,wire_path TEXT,decoded_path TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS classifier_resolutions(attempt TEXT PRIMARY KEY REFERENCES attempts(id),resolved_at INTEGER NOT NULL,previous_gate TEXT NOT NULL,reason TEXT NOT NULL,evidence_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history_receipts(observation TEXT NOT NULL,sha TEXT NOT NULL,receipt_hash TEXT NOT NULL,PRIMARY KEY(observation,sha),FOREIGN KEY(observation,sha) REFERENCES history(observation,sha));
CREATE TABLE IF NOT EXISTS archive_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=3));
INSERT OR IGNORE INTO archive_schema VALUES(1,3);
CREATE TABLE IF NOT EXISTS snapshot_metadata(snapshot TEXT PRIMARY KEY REFERENCES snapshots(id),adapter_schema INTEGER NOT NULL,observation_count INTEGER NOT NULL,headers TEXT,headers_hash TEXT,original_retrieved_at TEXT);
CREATE TABLE IF NOT EXISTS artifact_checkpoints(path TEXT PRIMARY KEY,sha TEXT NOT NULL,bytes INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('writing','promoted')),partial TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS validation_history(source TEXT NOT NULL,url TEXT NOT NULL,sha TEXT NOT NULL,receipt_hash TEXT NOT NULL,receipt TEXT NOT NULL,observed TEXT NOT NULL,PRIMARY KEY(source,url,sha,receipt_hash),FOREIGN KEY(source,url,sha) REFERENCES versions(source,url,sha));
`;
function tables(db:Database):Set<string> {
 return new Set(db.query<{name:string},[]>("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
}
function requireTables(db:Database,names:string[]) {
 const actual=tables(db);
 if(names.some(name=>!actual.has(name))) throw new Error("archive schema missing required table");
}
export function initialize(db:Database,existing:boolean):void {
 db.exec("PRAGMA foreign_keys=ON");
 if(!existing) {db.exec(BASE+EXTRA);return;}
 requireTables(db,BASE_TABLES);
 const actual=tables(db);
 if(actual.has("archive_schema")) {requireTables(db,EXTRA_TABLES);return;}
 if(actual.has("snapshot_metadata")) throw new Error("archive schema marker missing");
 throw new Error("archive schema requires explicit evidenced migration; no automatic repair");
}
const TRANSPORT_COLUMNS:Record<string,string[]>={
 cooldowns:['id','not_before','blocked'],
 robots:['origin','body','sha','delay','observed'],
 representations:['attempt','encoding','representation','wire_bytes','decoded_bytes','encoded_hash','decoded_hash','wire_path','decoded_path'],
 classifier_resolutions:['attempt','resolved_at','previous_gate','reason','evidence_hash'],
};
function verifyTransportSchema(db:Database):void {
 for(const [table,expected] of Object.entries(TRANSPORT_COLUMNS)) {
  const columns=db.query<{name:string},[]>(`PRAGMA table_info(${table})`).all().map(row=>row.name);
  if(JSON.stringify(columns)!==JSON.stringify(expected)) throw Error('transport schema column mismatch');
 }
}
type CooldownState={id:number;not_before:number;blocked:string|null};
export function readCooldown(db:Database):CooldownState {
 const rows=db.query<CooldownState,[]>("SELECT id,not_before,blocked FROM cooldowns").all();
 if(rows.length!==1 || rows[0]!.id!==1) throw Error('cooldown singleton missing or invalid');
 const row=rows[0]!;
 const checks=[Number.isSafeInteger(row.not_before),row.not_before>=0,row.blocked===null || (typeof row.blocked==='string' && row.blocked.trim().length>0)];
 if(!checks.every(Boolean)) throw Error('cooldown timestamp or blocked value invalid');
 return row;
}
export function verifySchema(db:Database):void {
 verifyTransportSchema(db);
 requireTables(db,[...BASE_TABLES,...EXTRA_TABLES]);
 readCooldown(db);
 const base=db.query<{schema_version:number},[]>("SELECT schema_version FROM settings WHERE id=1").get();
 const extension=db.query<{version:number},[]>("SELECT version FROM archive_schema WHERE id=1").get();
 if(base?.schema_version!==1 || extension?.version!==3) throw new Error("schema mismatch");
 const integrity=db.query<{integrity_check:string},[]>("PRAGMA integrity_check").get();
 if(integrity?.integrity_check!=="ok" || db.query("PRAGMA foreign_key_check").all().length) throw new Error("SQLite integrity failure");
}
