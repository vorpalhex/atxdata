import type { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, relative, isAbsolute } from "node:path";
import { Archive } from "./archive";
import { Store, type Observation } from "./store";
import { statFile } from "../../civicclerk-consume/src/archive";
import { readonlyGate } from "./app-preopen";
import { ensure, object } from "./check";

/** Capabilities used by the existing app/source verifier, including its live branches.
 * A readonly implementation explicitly refuses those branches; it is never cast to Archive.
 */
export type AppEvidence = Pick<
  Archive,
  "root" | "read" | "readExpected" | "verify" | "request" | "guard"
> & {
  store: Pick<
    Store,
    | "db"
    | "preflight"
    | "notBefore"
    | "options"
    | "observation"
    | "observations"
    | "integrity"
    | "verifyHistory"
    | "defer"
  >;
};
type EvidenceStoreView = AppEvidence["store"];
class EvidenceStore implements EvidenceStoreView {
  constructor(readonly db: Database) {}
  preflight() {
    readonlyGate(this.db);
  }
  notBefore() {
    return readonlyGate(this.db);
  }
  options(run: string) {
    return Store.prototype.options.call(this, run);
  }
  observation(run: string, label: string) {
    return Store.prototype.observation.call(this, run, label);
  }
  observations() {
    return Store.prototype.observations.call(this);
  }
  integrity() {
    return Store.prototype.integrity.call(this);
  }
  verifyHistory() {
    return Store.prototype.verifyHistory.call(this);
  }
  defer(_until: number): never {
    throw Error("readonly app evidence cannot defer or mutate");
  }
}

/** No Store/Archive constructor, writer, recovery, promotion, parser or transport. */
export class ReadonlyAppEvidence implements AppEvidence {
  readonly store: EvidenceStore;
  private readonly ledger: Buffer;
  constructor(
    readonly root: string,
    db: Database,
  ) {
    this.store = new EvidenceStore(db);
    this.store.preflight();
    this.ledger = db.serialize();
  }
  assertCurrent() {
    this.store.preflight();
    ensure(
      this.ledger.equals(this.store.db.serialize()),
      "app source ledger changed during verification",
    );
    this.store.verifyHistory();
  }
  get guard(): Archive["guard"] {
    return undefined;
  }
  set guard(_value: Archive["guard"]) {
    throw Error("readonly app evidence cannot set a guard");
  }
  request: Archive["request"] = async () => {
    throw Error("readonly app evidence cannot request");
  };
  readExpected(...args: Parameters<Archive["readExpected"]>) {
    return Archive.prototype.readExpected.call(this, ...args);
  }
  private async bytes(row: Observation) {
    ensure(
      row.status === "ready",
      "readonly app observation is pending; review required",
    );
    ensure(
      !isAbsolute(row.path) &&
        relative(this.root, resolve(this.root, row.path)) === row.path &&
        !row.path.includes(".."),
      "unsafe checkpoint path",
    );
    const path = join(this.root, row.path);
    const stat = await statFile(path);
    ensure(
      stat && stat.size === row.bytes,
      "checkpoint checksum/size mismatch",
    );
    for (const suffix of [".pending", ".part"]) await statFile(path + suffix);
    const raw = await readFile(path);
    ensure(
      raw.length === row.bytes &&
        createHash("sha256").update(raw).digest("hex") === row.sha256,
      "checkpoint checksum mismatch",
    );
    return raw;
  }
  async read(run: string, label: string): ReturnType<Archive["read"]> {
    this.store.options(run);
    const row = this.store.observation(run, label);
    ensure(row, "missing offline checkpoint");
    const raw = await this.bytes(row);
    return row.kind === "json"
      ? object(JSON.parse(raw.toString()))
      : row.kind === "text"
        ? raw.toString()
        : raw;
  }
  async verify(): ReturnType<Archive["verify"]> {
    this.assertCurrent();
    for (const row of this.store.db
      .query<{ run: string }, []>("SELECT run FROM acquisition_options")
      .all())
      this.store.options(row.run);
    const integrity = this.store.integrity();
    ensure(
      integrity.integrity === "ok" && integrity.foreignKeys.length === 0,
      "SQLite integrity failed",
    );
    const rows = this.store.observations();
    for (const row of rows) await this.bytes(row);
    this.assertCurrent();
    return { ...integrity, files: rows.length, httpRequests: 0 };
  }
}
