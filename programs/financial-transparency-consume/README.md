# Financial transparency consume

Offline Bun/TypeScript importer for the Travis County publisher's fiscal-year payment-register CSV. SQLite persists independent file snapshots and their provenance. **Browser download is separate:** obtain the CSV through the publisher's ordinary browser interface, then give this program the downloaded local file. This program contains no downloader, HTTP transport, browser automation, credentials, or Power BI query machinery. Old `seed` and `collect` commands are unsupported.

Source identity: <https://financialtransparency.traviscountytx.gov/VPR>. Import records this stable URL, the requested fiscal year, timestamp, original file SHA-256, byte size, status, and counters privately in SQLite. This identity is not a signature: the importer cannot authenticate that an operator-provided file was actually downloaded from the publisher.

## Run

Requires Bun 1.3.14+ and a local filesystem with SQLite and exclusive-create semantics. From this program directory:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run src/cli.ts --help
bun run src/cli.ts import --file "$SOURCE_CSV" --fiscal-year 2027 --output "$ARCHIVE"
bun run src/cli.ts verify --output "$ARCHIVE"
bun run src/cli.ts status --output "$ARCHIVE"
```

`SOURCE_CSV` and `ARCHIVE` are operator-selected private locations, not repository paths. Create the archive directory first with mode `0700`. It must be an existing canonical absolute directory owned by the current user, outside **every** checkout (`.git` file or directory in any ancestor), without symlink ancestors. Archive files must be private, regular, current-user-owned and singly linked. Do not share the archive with other programs or put downloaded data in this checkout.

Import defaults: `--max-bytes 104857600` (100 MiB), `--max-rows 1000000`. Overrides and fiscal year must be positive safe integers; CLI integers use decimal digits without signs, fractions, exponents, whitespace or leading zeroes. All integer options are checked before file IO. Limits bound this synchronous, in-memory parser; this is not a streaming importer. Use smaller limits where memory is constrained. File bytes include the header/BOM; row limits count data records, including rejected records. Exact limits are inclusive.

### Exit codes and output

- Import `0`: clean import, or verified reuse of an identical clean file.
- Import `2`: **`imported_with_rejections` / partial**, including reuse of an identical partial file. Accepted rows remain available.
- Import `1`: validation, parser, filesystem, locking, or SQLite failure; no successful batch is recorded.
- Verify/status `0`: local archive integrity passed, **even when import status is partial**. Read the returned status and counters. Exit `1` means verification failed.

Normal output is one JSON object containing hashes, fiscal year, byte/row counts, status, and reuse flag as applicable. No records, vendors, input paths or exception stacks are printed. Failure is the fixed object `{"error":"operation_failed"}`; help is plain text. Inspect the private archive with appropriate local tools for detailed investigation. There is deliberately no raw-record dump or arbitrary SQL CLI.

`rowsRead = accepted + rejected`. These are **CSV row counts**, not distinct payments or transactions. Neither `imported` nor successful verification means a complete financial census, complete fiscal year, complete history, or current publisher state. Missing-year completeness is unknown.

## CSV contract and grain

The exact ordered header is:

```text
Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate
```

The publisher's spelling **`Purchainging Order #`** is intentional. Header drift, malformed quotes, truncated quoted records, or invalid UTF-8 abort the whole import before acceptance. Pinned `csv-parse` handles quoting, escaped quotes, embedded newlines, CRLF and optional UTF-8 BOM. Record ordinals count CSV records, not physical lines: stored ordinal 1 is the first data record, CSV record 2 including the header.

Each data record is retained in `rows` under `(batch, ordinal)`, with its complete string-field array in `fields` (JSON text **inside SQLite**), integer-cents decimal text in `cents`, and nullable `reason`. Empty fields remain empty strings; there is no implicit null coercion or trimming. IDs, leading zeroes, dates, descriptions and original amount strings remain unchanged. All original bytes are also retained, including malformed-width records.

Rows are quarantined with the first applicable reason:

1. `row_width`: not exactly 13 fields, without shifting or repairing columns.
2. `bad_money`: amount is not `-?digits[.one-or-two-digits]`. No rounding, floats, exponents, grouping separators, currency symbols or precision loss. Cents are calculated with `BigInt` and stored as text; negative adjustments remain negative.
3. `bad_date`: payment date is missing/invalid, or nonempty encashment date is invalid. Strict calendar dates support `YYYY-MM-DD` and `M/D/YYYY`; original strings are preserved.
4. `year_mismatch`: Fiscal Year field does not exactly match the requested year. Calendar-date validity is separate; no additional fiscal-period or historical-completeness inference is made.

There is **no payment-number/line-item deduplication**. Legitimate rows sharing those identifiers but differing in department/category, including positive/negative adjustments, remain separate. Identical row repetitions within one file are also retained.

## Snapshots, verification and recovery

- `state.sqlite` has a versioned, exact checked schema: `batches` and `rows`, with foreign keys. Existing legacy/foreign databases are refused, not migrated or overwritten. Use a fresh archive for this importer.
- Originals are exclusively created as `<SHA256>.csv` with mode `0400`; the database uses mode `0600`. Existing original names are never overwritten. Original source files are read only. Read-only permissions are not protection against a privileged or same-owner hostile process.
- Identical source bytes reuse the existing batch **only after verifying the stored original and persisted rows**. Reuse preserves the original timestamp and partial status. Changed bytes create a separate snapshot: no cross-file merge, latest-state interpretation or automatic reconciliation. Archive-wide status sums snapshots and therefore is not a deduplicated financial total.
- Every invocation takes an exclusive `.lock`; existing locks are never stolen. SQLite writes run in one immediate transaction with full synchronization and rollback on failure. The raw original is created before committing its batch.
- Interruption may leave a lock, journal, incomplete database, or unreferenced original. The program fails closed on orphan/unknown artifacts; it does **not** overwrite them or automatically retry/reconstruct a batch. Preserve the entire archive for operator-assisted recovery. There is no force, reset, remote resume, or stale-lock deletion command. Do not delete evidence merely to make a rerun pass. Uncommitted SQLite rows are not a successful batch; `verify` is the acceptance gate after recovery. Power-loss behavior and hostile concurrent filesystem replacement are not guaranteed.
- `verify` and `status` run SQLite `integrity_check` and foreign-key checks, check schema/artifact safety, hash original bytes, reparse each original, and compare **every ordinal, field array, cents, rejection reason and batch count/status** with persistence. Missing originals or tampering fail. Verification costs grow with retained snapshots and never calls the publisher. It is internal consistency verification, not cryptographic authenticity or upstream freshness.

## Offline tests and quality

Tests contain authored synthetic examples only; no downloaded payment rows are repository fixtures. Select an existing private scratch directory outside checkouts via `FINANCIAL_TEST_ROOT`. All generated fixtures and databases are created there and removed by tests.

```sh
# macOS: OS denial covers Bun and all child CLI processes, not just PATH stubs.
FINANCIAL_TEST_ROOT="$PRIVATE_SCRATCH" sandbox-exec -p '(version 1)(allow default)(deny network*)' bun test
bun run typecheck
```

Use equivalent OS-level outbound-network denial on other systems. No test needs source access. Real retained publisher-file import/reuse/verification was separately exercised in a private archive: 19,459 data records, 19,458 accepted and one width rejection; import and reuse returned `2`, verify/status returned `0` while retaining partial status. This is offline import proof, not acquisition or year-completeness proof.

Quality tools were exercised in a private mirror: coverage/CRAP, structural duplication and bounded mutation testing. Line/function coverage is not branch coverage. Some defensive or equivalent mutants survive; private closeout evidence records actual counts, scope and triage, not a claim of perfect testing. Parent review/integration remains separate; this change does not commit or publish data.
