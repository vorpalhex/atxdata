# Financial transparency consume

Bun/TypeScript acquisition companion and offline importer for the Travis County publisher's fiscal-year payment-register CSV. The existing v1 SQLite importer is unchanged. Browser download remains a separate optional input route; anonymous static-file acquisition is now available through `discover` and `collect` (`acquire` alias). No browser automation, credentials, or Power BI query/token replay is used. `seed` remains unsupported.

Source identity: <https://financialtransparency.traviscountytx.gov/VPR>. Import records this stable URL, the requested fiscal year, timestamp, original file SHA-256, byte size, status, and counters privately in SQLite. This identity is not a signature: the importer cannot authenticate that an operator-provided file was actually downloaded from the publisher.

## Native acquisition

The observed normal-browser download destination is the public static file `https://tctransparency.traviscountytx.gov/Reports/DataSAP/PaymentRegister_YEAR.csv`. The same filename contract is used for caller-selected positive integer fiscal years. No sample year or browser dropdown range is a production allowlist, and no universal earliest year is assumed.

`discover` requires an explicit year or inclusive caller-bounded range. It sends HEAD requests to candidate filenames, not a claimed publisher index or exhaustive history crawl. `metadata_available` means HTTP 200 only: it is not CSV/header/year/completeness validation. `unavailable` records HTTP 404/410; other failures remain unknown and stop the run. The browser dropdown can differ from actual file availability. Discovery caches a locally authored HEAD envelope with original response headers and `bodyBytes: 0`, never a CSV original. Envelope bytes are conservatively charged to its run budget.

Keep SOURCE_ARCHIVE separate from the v1 IMPORT_ARCHIVE; both must be existing private canonical absolute directories outside all checkouts. This program imports sibling ArcGIS/CivicClerk/Legistar modules from the same repository checkout; copying only this program directory is not a standalone distribution. No additional package is required for the financial adapter. Use the frozen lockfile; do not add data as fixtures.

```sh
bun run src/cli.ts discover --source-archive "$SOURCE_ARCHIVE" --fiscal-year "$FY" --max-requests 3
bun run src/cli.ts discover --source-archive "$SOURCE_ARCHIVE" --first-year "$FIRST_FY" --last-year "$LAST_FY" --max-requests 10
bun run src/cli.ts collect --source-archive "$SOURCE_ARCHIVE" --output "$IMPORT_ARCHIVE" --fiscal-year "$FY" --max-requests 3 --max-bytes 104857600 --max-total-bytes 209715200 --max-rows 1000000
bun run src/cli.ts verify-source --source-archive "$SOURCE_ARCHIVE" --output "$IMPORT_ARCHIVE"
```

All four acquisition controls are positive finite safe integers, checked before IO or reuse. Defaults are 10 requests, 100 MiB per raw file/response, 200 MiB aggregate consumed bodies per run, and one million CSV data records (including quarantine). These are configurable safety ceilings, not sample-size allowlists: the ordinary FY2026 HEAD-declared 38,248,830-byte export fits the defaults. Its contents have not been acquired or validated. Request budget includes robots when not cached. Candidate count cannot exceed the request budget, and a new archive may need one extra request for policy. Exceeding a bound fails closed, without importing a prefix. Parsing is synchronous/in-memory, so select bounds appropriate to available memory. HTTP-error bodies are canceled rather than archived; attempts retain status/headers and zero consumed-body bytes, not a claimed full error-body original.

The companion reuses the shared SQLite Archive/Store, full-body serial request queue, manual redirects, attempt reservations, cooldown persistence and exclusive-create promotion. Retries are fixed at zero and redirects are never followed. Completion-to-next-request spacing is at least three seconds and any stricter Crawl-delay, Retry-After, structured RateLimit or RateLimit/X-RateLimit remaining/reset delay wins, including on HTTP 200 and across restart. Uninterpretable cooldowns fail closed. Robots 404/410 is cached as absent policy; successful robots text is retained. The adapter conservatively refuses any nonempty Disallow, even in another user-agent group; this can require manual policy review rather than selectively ignoring a restriction. Cached policy failures do not cause automatic retries. There is no force/reset/cookie/auth/proxy command.

`collect` validates actual UTF-8 bytes, the exact ordered header, every source-year field (even on malformed-width records), and row limits. `application/octet-stream` is accepted; extension/MIME alone does not validate content. Valid-width and malformed-width data then go through the unchanged general importer, preserving exact cents, source strings, ordinals and quarantine reasons. A source run binds the exact acquisition URL, fiscal year, raw SHA-256/bytes and complete existing import-batch metadata/counts/status. `verify-source` rehashes originals, reparses bytes, verifies request/observation/version provenance and compares the bound batch with the actual v1 archive, not merely unrelated checksums. It is local consistency evidence, not a publisher signature.

`maxTotalBytes` / `--max-total-bytes` limits consumed bodies (plus conservatively charged derived HEAD-envelope bytes) within one acquisition run, not the sum of retained cache files. Zero-HTTP cache reuse consumes zero new body bytes, so a cached CSV can exceed a newly requested aggregate limit of 1 byte. The cached CSV must still fit the caller's per-file `maxBytes` and `maxRows` limits. Explicit refresh starts a separately budgeted run and retains earlier observations/versions.

Source commands perform a read-only semantic ledger/import-binding preflight before opening the shared writer, recovery, spacing changes or HTTP. This validates all retained candidate envelopes/summaries, selected identities, original/derived header relationships, completed response accounting and bound v1 batches, not only the requested year. Run/attempt/import wall-clock times must be parseable and ordered. New import timestamps are bounded by their producing run; rebinding an already verified v1 batch preserves its earlier `importedAt` rather than inventing a new import event. New receipts explicitly mark such reuse with `importReused: true`; the v1 schema and batch fields remain unchanged.

Source archives require the exact eighth `timing_events` table and independently validated provider facts. Observation/version retrieval is checked against its own provider-clock checkpoint bounds, with the separately captured checkpoint wall time mapped inside the wall-clock attempt interval. Mutable cooldown is policy, never a retrieval ceiling. Raising cooldown alongside a forged retrieval date cannot authorize that history; singleton/type checks, retained scheduling obligations and manual stops still apply. Offline verification does not append scheduling facts in a different reader clock domain.

For a settled valid source archive, the positive verification test checks unchanged schema, all eight logical tables (including timing facts and the policy gate), immutable original-body hashes, and zero HTTP. It deliberately retires earlier producer resources with GC. SQLite may checkpoint the retired producer's WAL into the main file during that lifecycle, so byte-identical main/WAL layout is not the positive contract. Negative corruption tests keep their separate physical durable-file/no-writer/no-transport guards; this does not authorize changes to corrupt evidence.

An unchanged older seven-table source archive, missing checkpoint/completion evidence, or an unfinished dispatched transport requires explicit operator review. Preserve it unchanged: no facts, completion time or migration are manufactured. Current evidence-bearing replay of retained CSV bytes has newly recorded fixture timing and is not recovered historical acquisition chronology. The separate exact-v1 importer remains compatible and can still verify an unchanged old import archive. Verification is internal consistency checking, not authenticated forensic time.

By default, collect and discovery reuse verified cached selections with zero HTTP. `--refresh` explicitly requests a new independent snapshot; unchanged bytes reuse the existing import batch while retaining the new source attempt. Failed/unavailable selections are cached; an unavailable collect returns status `unavailable`, exit 3. Unsupported CSV/redirect content returns status `unsupported`, exit 4, without exposing the body. Clean/partial collect exits 0/2, exactly like import. Other policy, budget, lock, corruption or unknown transport failures return the fixed error object and exit 1. Successful discovery and verify-source exit 0. Import/status/verify commands below remain v1-compatible and offline.

Each source archive has one `.civicclerk.lock` writer (the shared engine's lock name); separate source archives do not coordinate host-wide traffic. Use one source archive per publisher and one bound import archive. New originals are never overwritten; successful CSV originals are mode 0400 and private SQLite/metadata files use mode 0600. Same-owner privileged tampering is not prevented; verification detects inconsistent changes. Interrupted attempts retain conservative reserved-byte accounting and locks; even after manual lock recovery, an unfinished attempt blocks new traffic. Failed validation can retain `.pending` bytes as private evidence. Unknown/orphan artifacts, unsafe paths, symlinks, foreign schemas and conflicting locks fail closed. Preserve the entire archive for manual recovery; the CLI never steals a lock, retries an interrupted download or byte-range resumes.

Bounded native acceptance actually acquired FY2027 once (a disclosed repeat of a retained normal-browser dataset): SHA-256 `2eecb8cc58d02a722143ee8d41eeb96f00e6c0a76d25b8fb4d1804924a837075`, 3,217,989 bytes, 19,487 CSV records, 19,486 accepted and one width quarantine. Robots404 and HEAD200 for FY2026/FY2027 were the other three requests. FY2026 remains metadata-only. Zero-network acquisition reuse, discovery reuse, source-bound verification and verification of a copy of the retained real v1 archive were separately exercised under the earlier provider. Those original source ledgers predate independent timing facts and now require operator review; historical cache-success receipts are not current source-cache compatibility clearance. An evidence-bearing retained-byte replay records new fixture timing only. This does not establish complete years or historical coverage. No captured source rows are repository fixtures.

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
FINANCIAL_TEST_ROOT="$PRIVATE_SCRATCH" TMPDIR="$PRIVATE_SCRATCH" sandbox-exec -p '(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:*"))(allow network-bind (local ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))' bun test
bun run typecheck
```

Use equivalent OS-level public-network denial with explicit localhost bind/inbound/outbound permission on other systems. The native fixture's denial self-check uses macOS `/usr/bin/python3` to verify inherited errno 1; adapt that check when porting. No test needs source access. Keep TMPDIR and FINANCIAL_TEST_ROOT canonical existing external private paths. Tests cover separate-process native localhost streaming, arbitrary years, second snapshots above the former sample body cap, strict budgets, cooldown/reopen, interruption accounting, no-clobber/locks/symlinks, unsupported/unavailable outcomes and semantic provenance tampering. Native public-source evidence is separate from authored fixtures.

Quality tools were exercised in a private mirror: coverage/CRAP, structural duplication and bounded mutation testing. Line/function coverage is not branch coverage. Some defensive or equivalent mutants survive; private closeout evidence records actual counts, scope and triage, not a claim of perfect testing. Parent review/integration remains separate; this change does not commit or publish data.
