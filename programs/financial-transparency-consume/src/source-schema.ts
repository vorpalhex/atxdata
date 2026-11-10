import type { Database } from 'bun:sqlite';
import { ensure } from './acquisition-options';
import { timingSchema } from '../../arcgis-consume/src/timing';
// Exact Archive/Store contract; read-only, including independent timing facts.
const schema = [
  'CREATE TABLE acquisition_options(run TEXT PRIMARY KEY, options TEXT NOT NULL)',
  'CREATE TABLE attempts(id TEXT PRIMARY KEY,run TEXT NOT NULL REFERENCES runs(id),label TEXT NOT NULL,url TEXT NOT NULL,started TEXT NOT NULL,finished TEXT,status INTEGER,headers TEXT,bytes INTEGER NOT NULL DEFAULT 0,error TEXT)',
  'CREATE TABLE cooldown(id INTEGER PRIMARY KEY CHECK(id=1),not_before REAL NOT NULL)',
  "CREATE TABLE observations(run TEXT NOT NULL REFERENCES runs(id),label TEXT NOT NULL,url TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','ready')),kind TEXT NOT NULL,retrieved TEXT NOT NULL,PRIMARY KEY(run,label))",
  'CREATE TABLE runs(id TEXT PRIMARY KEY,source TEXT REFERENCES sources(id),command TEXT NOT NULL,status TEXT NOT NULL,started TEXT NOT NULL,finished TEXT,error TEXT,summary TEXT)',
  'CREATE TABLE sources(id TEXT PRIMARY KEY,label TEXT NOT NULL,original_url TEXT NOT NULL)',
  timingSchema,
  'CREATE TABLE versions(source TEXT NOT NULL REFERENCES sources(id),label TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,path TEXT NOT NULL,first_retrieved TEXT NOT NULL,publication_date TEXT,PRIMARY KEY(source,label,sha256))',
];
function definitions(db: Database) {
  return db.query<{sql:string},[]>("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all().map(row=>row.sql);
}
export function validateDefinitions(db: Database, expected: readonly string[], message: string) {
  ensure(JSON.stringify(definitions(db)) === JSON.stringify(expected), message);
}
export function validateSourceSchema(db: Database) {
  const actual = definitions(db);
  const legacy = schema.filter(definition=>definition !== timingSchema);
  ensure(JSON.stringify(actual) !== JSON.stringify(legacy), 'legacy timing evidence unavailable: operator review required');
  validateDefinitions(db,schema,'foreign acquisition schema');
}
