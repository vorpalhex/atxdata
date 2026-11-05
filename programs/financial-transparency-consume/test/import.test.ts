import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { archivePath, privateFile, withLock } from "../src/archive";
import { positiveInteger } from "../src/model";
import { input } from "../src/files";
import { linkSync } from "node:fs";
import { runCli } from "../src/cli";
import { verifyArchive, statusArchive } from "../src/verify";
import { importCsv } from "../src/importer";
const roots: string[] = [];
export const header =
  "Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate";
export const row = (amount = "428.19", department = "A") =>
  `2027,10/01/2026,0001,Synthetic vendor,0002,${amount},,${department},001,Example,002,"authored, example",`;
function setup(body: string) {
  const root = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, "case-"));
  roots.push(root);
  const output = join(root, "archive");
  mkdirSync(output, { mode: 0o700 });
  const file = join(root, "input.csv");
  writeFileSync(file, body);
  return { output, file };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
test("interrupted SQLite sidecar evidence fails closed without changing retained files", () => {
  const { file, output } = setup(header + "\n" + row());
  importCsv({ file, output, fiscalYear: 2027 });
  const journal = join(output, "state.sqlite-journal");
  const child = Bun.spawnSync([
    process.execPath,
    "-e",
    `import {Database} from "bun:sqlite"; const db=new Database(process.argv[1]); db.exec("PRAGMA cache_size=1; PRAGMA synchronous=FULL; BEGIN IMMEDIATE; UPDATE batches SET status='interrupted'; WITH RECURSIVE seq(x) AS (VALUES(2) UNION ALL SELECT x+1 FROM seq WHERE x<2000) INSERT INTO rows SELECT batch,x,fields,cents,reason FROM rows CROSS JOIN seq WHERE ordinal=1"); process.kill(process.pid,"SIGKILL");`,
    join(output, "state.sqlite"),
  ]);
  expect(child.exitCode).not.toBe(0);
  expect(existsSync(journal)).toBe(true);
  const journalBytes = readFileSync(journal);
  expect(journalBytes.length).toBeGreaterThan(0);
  const databaseBytes = readFileSync(join(output, "state.sqlite"));
  expect(() => verifyArchive(output)).toThrow();
  expect(readFileSync(join(output, "state.sqlite"))).toEqual(databaseBytes);
  expect(existsSync(journal)).toBe(true);
  expect(readFileSync(journal)).toEqual(journalBytes);
});
test("unsupported or extra CLI arguments cannot masquerade as a successful verified import", () => {
  const { file, output } = setup(header + "\n" + row());
  importCsv({ file, output, fiscalYear: 2027 });
  const base = [
    "import",
    "--file",
    file,
    "--output",
    output,
    "--fiscal-year",
    "2027",
  ];
  for (const args of [
    [...base, "extra"],
    [...base, "--unknown"],
    [...base, "--max-rows", ""],
    [...base, "--max-bytes", ""],
    ["seed", "--output", output],
    ["collect", "--output", output],
    ["verify", "--output", output, "--max-rows", "1"],
  ]) {
    const messages: string[] = [];
    expect(runCli(args, (s) => messages.push(s))).toBe(1);
    expect(messages).toEqual(['{"error":"operation_failed"}']);
  }
});
test("archive path is canonical and outside every ancestor checkout", () => {
  const { file, output } = setup(header + "\n" + row());
  expect(() =>
    importCsv({ file, output: output + "/.", fiscalYear: 2027 }),
  ).toThrow();
  const nested = join(output, "nested");
  mkdirSync(nested, { mode: 0o700 });
  mkdirSync(join(output, ".git"));
  expect(() => importCsv({ file, output: nested, fiscalYear: 2027 })).toThrow();
});
test("original hash detects semantically equivalent same-byte-count CSV tampering", () => {
  const { file, output } = setup(header + "\n" + row());
  const batch = importCsv({ file, output, fiscalYear: 2027 });
  const path = join(output, batch.fileSHA256 + ".csv");
  chmodSync(path, 0o600);
  writeFileSync(path, readFileSync(path, "utf8").replace("\n", "\r"));
  expect(() => verifyArchive(output)).toThrow();
  expect(() => importCsv({ file, output, fiscalYear: 2027 })).toThrow();
});
test("CLI rejects FIFO input promptly rather than waiting for a writer", () => {
  const { file, output } = setup("");
  rmSync(file);
  expect(Bun.spawnSync(["/usr/bin/mkfifo", file]).exitCode).toBe(0);
  const child = Bun.spawnSync(
    [
      process.execPath,
      join(import.meta.dir, "../src/cli.ts"),
      "import",
      "--file",
      file,
      "--fiscal-year",
      "2027",
      "--output",
      output,
    ],
    { timeout: 1000, killSignal: "SIGKILL" },
  );
  expect(child.exitCode).toBe(1);
  expect(child.stdout.toString().trim()).toBe('{"error":"operation_failed"}');
  expect(readdirSync(output)).toEqual([]);
});
test("rejects private FIFO artifacts without opening them", () => {
  const { output } = setup("");
  const fifo = join(output, "fifo");
  const child = Bun.spawnSync(["/usr/bin/mkfifo", fifo]);
  expect(child.exitCode).toBe(0);
  chmodSync(fifo, 0o600);
  expect(() => privateFile(fifo)).toThrow("unsafe_artifact");
});
test("oversized input fails at the file bound rather than parsing a prefix", () => {
  const { file } = setup("synthetic");
  expect(() => input(file, 1)).toThrow("file_limit");
});
test("positive integer boundary rejects zero and accepts one", () => {
  expect(positiveInteger(1)).toBe(1);
  expect(() => positiveInteger(0)).toThrow("invalid_integer");
});
test("accepts exact file and row bounds", () => {
  const body = header + "\n" + row();
  const { file, output } = setup(body);
  expect(
    importCsv({
      file,
      output,
      fiscalYear: 2027,
      maxRows: 1,
      maxBytes: Buffer.byteLength(body),
    }).accepted,
  ).toBe(1);
});
test("does not create a database for verify of an empty archive", () => {
  const { output } = setup("");
  expect(() => verifyArchive(output)).toThrow();
  expect(readdirSync(output)).toEqual([]);
});
test("requires regular private singly linked artifact files", () => {
  const { file, output } = setup(header);
  chmodSync(file, 0o600);
  privateFile(file);
  chmodSync(file, 0o644);
  expect(() => privateFile(file)).toThrow();
  chmodSync(file, 0o600);
  const link = join(output, "link");
  linkSync(file, link);
  expect(() => privateFile(file)).toThrow();
  rmSync(link);
  symlinkSync(file, link);
  expect(() => privateFile(link)).toThrow();
  rmSync(link);
  expect(() => privateFile(output)).toThrow();
  expect(() => input(output, 100)).toThrow();
});
test("lock ownership survives a replaced lock and is not stolen by another writer", () => {
  const { output } = setup("");
  withLock(output, () => {
    expect(() => withLock(output, () => {})).toThrow();
    const old = join(output, "old-lock");
    linkSync(join(output, ".lock"), old);
    rmSync(join(output, ".lock"));
    writeFileSync(join(output, ".lock"), "new-owner", { mode: 0o600 });
  });
  expect(readFileSync(join(output, ".lock"), "utf8")).toBe("new-owner");
});
test("invalid CLI arity and missing required options never touch archive", () => {
  const { file, output } = setup(header + "\n" + row());
  for (const args of [
    ["import", "--output", output, "--fiscal-year", "2027"],
    ["import", "--output", output, "--file", file],
    ["verify", "extra", "--output", output],
    ["--output", output],
    ["verify", "--output", output, "--max-rows", "1"],
    ["--help", "extra"],
    ["status", "--file", file, "--output", output],
  ]) {
    const messages: string[] = [];
    expect(runCli(args, (s) => messages.push(s))).toBe(1);
    expect(messages).toEqual(['{"error":"operation_failed"}']);
    expect(readdirSync(output)).toEqual([]);
  }
});
test.each([
  "same_size_raw",
  "rejected_count",
  "read_count",
  "status_value",
  "invalid_timestamp",
  "application_id",
  "user_version",
  "foreign_key",
])("detects independent %s corruption", (kind) => {
  const { file, output } = setup(header + "\n" + row());
  const batch = importCsv({ file, output, fiscalYear: 2027 });
  if (kind === "same_size_raw") {
    const path = join(output, batch.fileSHA256 + ".csv");
    chmodSync(path, 0o600);
    writeFileSync(path, readFileSync(path, "utf8").replace("vendor", "vEndor"));
  } else {
    const db = new Database(join(output, "state.sqlite"));
    const sql: Record<string, string> = {
      rejected_count: "UPDATE batches SET rejected=1",
      read_count: "UPDATE batches SET rowsRead=2",
      status_value: "UPDATE batches SET status='wrong'",
      invalid_timestamp:
        "UPDATE batches SET importedAt='2026-13-32T19:00:00.000Z'",
      application_id: "PRAGMA application_id=0",
      user_version: "PRAGMA user_version=2",
      foreign_key: "INSERT INTO rows VALUES('unbound',1,'[]',NULL,'row_width')",
    };
    db.exec(sql[kind]);
    db.close();
  }
  expect(() => verifyArchive(output)).toThrow();
  expect(() => importCsv({ file, output, fiscalYear: 2027 })).toThrow();
});
test("validates nullable encashment dates independently of payment dates", () => {
  for (const [date, accepted] of [
    ["2026-11-04", 1],
    ["02/29/2028", 1],
    ["2026-02-30", 0],
    ["not-a-date", 0],
    ["2026-13-01", 0],
  ] as const) {
    const { file, output } = setup(header + "\n" + row() + date);
    expect(importCsv({ file, output, fiscalYear: 2027 })).toMatchObject({
      accepted,
      rejected: 1 - accepted,
    });
    expect(verifyArchive(output)).toMatchObject({
      accepted,
      rejected: 1 - accepted,
    });
  }
});
test("rejects invalid UTF-8 instead of silently replacing data strings", () => {
  const { file, output } = setup(header + "\n" + row());
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from(header + "\n" + row().replace("Synthetic vendor", "")),
      Buffer.from([0xff]),
    ]),
  );
  expect(() => importCsv({ file, output, fiscalYear: 2027 })).toThrow();
  expect(readdirSync(output)).toEqual([]);
});
test("preserves BOM CSV quoted multiline strings and exact large cents", () => {
  const authored = row("9007199254740993.01")
    .replace("10/01/2026", "2026-10-01")
    .replace("authored, example", 'authored, ""example""\nnext line');
  const { file, output } = setup(
    "\uFEFF" + header + "\r\n" + authored + "\r\n",
  );
  const result = importCsv({ file, output, fiscalYear: 2027 });
  expect(result).toMatchObject({ accepted: 1, rejected: 0 });
  const db = new Database(join(output, "state.sqlite"));
  const data = db.query("SELECT * FROM rows").get() as any;
  expect(data.cents).toBe("900719925474099301");
  expect(JSON.parse(data.fields)[11]).toBe('authored, "example"\nnext line');
  db.close();
  expect(verifyArchive(output).integrity).toBe("ok");
});
test("help explains separate browser acquisition and removed commands fail safely", () => {
  const messages: string[] = [];
  expect(runCli(["--help"], (s) => messages.push(s))).toBe(0);
  expect(messages[0]).toContain("Browser download is separate");
  expect(messages[0]).toContain("import --file");
  for (const command of ["seed", "collect"]) {
    expect(
      runCli([command, "--output", "sensitive-path"], (s) => messages.push(s)),
    ).toBe(1);
    expect(messages.pop()).toBe('{"error":"operation_failed"}');
  }
});
test("rejects invalid CLI integers and duplicate options before archive IO", () => {
  const { file, output } = setup(header + "\n" + row());
  const base = [
    "import",
    "--file",
    file,
    "--output",
    output,
    "--fiscal-year",
    "2027",
  ];
  for (const suffix of [
    ["--output", output],
    ["--max-bytes", "0"],
    ["--max-rows", "1.5"],
    ["--max-rows", "Infinity"],
    ["--max-bytes", "9007199254740992"],
    ["--fiscal-year", "2026"],
    ["--unknown", "private-input"],
  ]) {
    const messages: string[] = [];
    expect(runCli([...base, ...suffix], (s) => messages.push(s))).toBe(1);
    expect(messages).toEqual(['{"error":"operation_failed"}']);
    expect(readdirSync(output)).toEqual([]);
  }
});
test("clean CLI import returns zero with safe aggregate output", () => {
  const { file, output } = setup(header + "\n" + row());
  const messages: string[] = [];
  expect(
    runCli(
      ["import", "--file", file, "--output", output, "--fiscal-year", "2027"],
      (s) => messages.push(s),
    ),
  ).toBe(0);
  expect(JSON.parse(messages[0])).toMatchObject({
    accepted: 1,
    rejected: 0,
    status: "imported",
  });
  expect(messages[0]).not.toContain(file);
  expect(messages[0]).not.toContain("Synthetic vendor");
});
test("shipped CLI exposes offline import, partial reuse, verify and status exits", () => {
  const { file, output } = setup(header + "\n" + row() + "\n" + row("bad"));
  const args = [
    "import",
    "--file",
    file,
    "--fiscal-year",
    "2027",
    "--output",
    output,
  ];
  const messages: string[] = [];
  expect(runCli(args, (s) => messages.push(s))).toBe(2);
  expect(JSON.parse(messages.pop()!)).toMatchObject({
    status: "imported_with_rejections",
    accepted: 1,
    rejected: 1,
    reused: false,
  });
  expect(runCli(args, (s) => messages.push(s))).toBe(2);
  expect(JSON.parse(messages.pop()!).reused).toBe(true);
  for (const command of ["verify", "status"]) {
    expect(runCli([command, "--output", output], (s) => messages.push(s))).toBe(
      0,
    );
    expect(JSON.parse(messages.pop()!)).toMatchObject({
      integrity: "ok",
      rowsRead: 2,
      rejected: 1,
    });
  }
  const child = Bun.spawnSync([
    process.execPath,
    join(import.meta.dir, "../src/cli.ts"),
    ...args,
  ]);
  expect(child.exitCode).toBe(2);
  expect(child.stderr.toString()).toBe("");
  expect(JSON.parse(child.stdout.toString())).toMatchObject({
    reused: true,
    accepted: 1,
    rejected: 1,
  });
});
test.each([
  "raw",
  "missing",
  "fields",
  "cents",
  "reason",
  "ordinal",
  "count",
  "source",
  "year",
  "timestamp",
  "bytes",
  "schema",
  "row_delete",
  "row_extra",
])("verify and reuse detect %s tampering", (kind) => {
  const { file, output } = setup(header + "\n" + row());
  const batch = importCsv({ file, output, fiscalYear: 2027 });
  const raw = join(output, batch.fileSHA256 + ".csv");
  if (kind === "raw") {
    chmodSync(raw, 0o600);
    writeFileSync(raw, "changed");
  } else if (kind === "missing") rmSync(raw);
  else {
    const db = new Database(join(output, "state.sqlite"));
    const changes: Record<string, string> = {
      fields: "UPDATE rows SET fields='[]'",
      cents: "UPDATE rows SET cents='1'",
      reason: "UPDATE rows SET reason='bad_money'",
      ordinal: "UPDATE rows SET ordinal=3",
      count: "UPDATE batches SET accepted=9",
      source: "UPDATE batches SET sourceURL='invalid'",
      year: "UPDATE batches SET fiscalYear=2026",
      timestamp: "UPDATE batches SET importedAt='invalid'",
      bytes: "UPDATE batches SET bytes=1",
      schema: "CREATE TABLE unexpected(id TEXT)",
      row_delete: "DELETE FROM rows",
      row_extra:
        "INSERT INTO rows SELECT batch,2,fields,cents,reason FROM rows",
    };
    db.exec(changes[kind]);
    db.close();
  }
  expect(() => verifyArchive(output)).toThrow();
  expect(() => importCsv({ file, output, fiscalYear: 2027 })).toThrow();
});
test("reuses only identical verified bytes and keeps changed files as separate snapshots", () => {
  const { file, output } = setup([header, row(), row("invalid")].join("\n"));
  const first = importCsv({ file, output, fiscalYear: 2027 });
  const second = importCsv({ file, output, fiscalYear: 2027 });
  expect(second).toEqual({ ...first, reused: true });
  writeFileSync(file, [header, row("1.00")].join("\n"));
  const third = importCsv({ file, output, fiscalYear: 2027 });
  expect(third.fileSHA256).not.toBe(first.fileSHA256);
  expect(verifyArchive(output)).toMatchObject({
    integrity: "ok",
    batches: 2,
    rowsRead: 3,
    accepted: 2,
    rejected: 1,
  });
  expect(statusArchive(output)).toMatchObject({
    batches: 2,
    rowsRead: 3,
    accepted: 2,
    rejected: 1,
    status: "imported_with_rejections",
  });
  const db = new Database(join(output, "state.sqlite"));
  expect(db.query("SELECT count(*) AS n FROM rows").get()).toEqual({ n: 3 });
  db.close();
});
test.each([
  "relative",
  "public",
  "symlink",
  "checkout",
  "lock",
  "foreign_db",
  "orphan",
])("refuses unsafe archive %s without overwriting originals", (kind) => {
  let { file, output } = setup(header + "\n" + row());
  const original = join(output, "0".repeat(64) + ".csv");
  if (kind === "relative") output = ".";
  if (kind === "public") chmodSync(output, 0o755);
  if (kind === "symlink") {
    const link = output + "-link";
    symlinkSync(output, link);
    output = link;
  }
  if (kind === "checkout") mkdirSync(join(output, ".git"));
  if (kind === "lock")
    writeFileSync(join(output, ".lock"), "existing-owner", { mode: 0o600 });
  if (kind === "foreign_db") {
    const db = new Database(join(output, "state.sqlite"));
    db.exec("CREATE TABLE foreign_data(id TEXT)");
    db.close();
    chmodSync(join(output, "state.sqlite"), 0o600);
  }
  if (kind === "orphan") writeFileSync(original, "retain-me", { mode: 0o400 });
  expect(() => importCsv({ file, output, fiscalYear: 2027 })).toThrow();
  if (kind === "orphan")
    expect(readFileSync(original, "utf8")).toBe("retain-me");
  if (kind === "lock")
    expect(readFileSync(join(output, ".lock"), "utf8")).toBe("existing-owner");
});
test("enforces finite positive bounds before file IO", () => {
  for (const options of [
    { maxBytes: 1 },
    { maxRows: 1 },
    { maxBytes: 0 },
    { maxRows: NaN },
    { maxBytes: Infinity },
    { fiscalYear: 2027.1 },
  ]) {
    const { file, output } = setup([header, row(), row()].join("\n"));
    expect(() =>
      importCsv({ file, output, fiscalYear: 2027, ...options }),
    ).toThrow();
    expect(readdirSync(output)).toEqual([]);
  }
});
test("rejects header drift and malformed CSV without accepting any batch", () => {
  for (const body of [
    header.replace("Purchainging", "Purchasing") + "\n" + row(),
    "",
    header + "\n" + row() + '\n"truncated',
    header + "\n" + row() + '\nabc"def',
  ]) {
    const { file, output } = setup(body);
    expect(() => importCsv({ file, output, fiscalYear: 2027 })).toThrow();
    expect(readdirSync(output)).toEqual([]);
  }
});
test("quarantines invalid rows without shifting columns or rounding money", () => {
  const badWidth = row() + ",extra";
  const badDate = row().replace("10/01/2026", "02/30/2026");
  const badYear = row().replace("2027,", "2026,");
  const body = [
    header,
    row("0.1"),
    row("-0.01"),
    badWidth,
    row("1.001"),
    badDate,
    badYear,
    row("NaN"),
    row("1e2"),
  ].join("\n");
  const { file, output } = setup(body);
  expect(importCsv({ file, output, fiscalYear: 2027 })).toMatchObject({
    status: "imported_with_rejections",
    rowsRead: 8,
    accepted: 2,
    rejected: 6,
  });
  const db = new Database(join(output, "state.sqlite"));
  const rows = db
    .query("SELECT ordinal,fields,cents,reason FROM rows ORDER BY ordinal")
    .all() as any[];
  expect(rows.map((r) => r.cents)).toEqual([
    "10",
    "-1",
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  expect(rows.map((r) => r.reason)).toEqual([
    null,
    null,
    "row_width",
    "bad_money",
    "bad_date",
    "year_mismatch",
    "bad_money",
    "bad_money",
  ]);
  expect(JSON.parse(rows[2].fields)).toHaveLength(14);
  db.close();
});
test("imports a snapshot without deduplicating shared payment and line IDs", () => {
  const body = header + "\n" + row() + "\n" + row("-428.19", "B") + "\n";
  const { file, output } = setup(body);
  const result = importCsv({ file, output, fiscalYear: 2027 });
  expect(result).toMatchObject({
    status: "imported",
    rowsRead: 2,
    accepted: 2,
    rejected: 0,
    reused: false,
  });
  const db = new Database(join(output, "state.sqlite"));
  const rows = db
    .query("SELECT ordinal,fields,cents,reason FROM rows ORDER BY ordinal")
    .all() as any[];
  expect(rows.map((r) => r.ordinal)).toEqual([1, 2]);
  expect(rows.map((r) => r.cents)).toEqual(["42819", "-42819"]);
  expect(JSON.parse(rows[0].fields)).toEqual([
    "2027",
    "10/01/2026",
    "0001",
    "Synthetic vendor",
    "0002",
    "428.19",
    "",
    "A",
    "001",
    "Example",
    "002",
    "authored, example",
    "",
  ]);
  const batch = db.query("SELECT * FROM batches").get() as any;
  expect(batch.sourceURL).toBe(
    "https://financialtransparency.traviscountytx.gov/VPR",
  );
  expect(batch.fiscalYear).toBe(2027);
  expect(batch.importedAt).toMatch(/^\d{4}-/);
  expect(batch.bytes).toBe(Buffer.byteLength(body));
  expect(readFileSync(join(output, batch.fileSHA256 + ".csv"), "utf8")).toBe(
    body,
  );
  db.close();
});
