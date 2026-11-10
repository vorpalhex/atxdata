# Clarity selected-election collector

Headless Bun/TypeScript + SQLite collector for the public Travis County Clarity file service. No server or scheduler. This is separate from the supervised county access recipe.

## Supported scope

- `list` / `discover`: one bounded catalog array (at most 100 entries), not exhaustive historical holdings.
- `collect` / `sync`: exactly one explicitly selected catalog-listed Travis election, by literal digits-only `--election` or real calendar `--date YYYY-MM-DD`. English published config, compatible schema/capabilities, one source-derived current version, the five JSON routes and advertised `detailxml.zip`. No election-ID or template-version allowlist.
- `status`: local SQLite state and the latest 20 run/coverage records.
- `verify`: offline SHA-256, gzip, ZIP CRC/XML, shared config/settings/XML identity validation, retained catalog/source/selection identity, exact file URLs/HTTP success states, reconciliation, normalized SQLite rows, integrity and foreign keys. No HTTP.

No version-history enumeration, guessed fallback routes, municipal IDs, voter data, authentication, cookies, challenges, certification inference or audit equivalence. Unsupported schema, policy, identity or format changes fail closed and require adapter review. IDs and leading zeroes remain source-scoped strings.

## CLI tooling

The package pins Commander 14.0.3 for option consumption, command metadata and
help, without a sibling/root parser dependency. Compatibility guards preserve
the documented contextual information, value and duplicate-option behavior.
Domain validation and checked output delivery are unchanged.

Run `bun run format` or `bun run format:check` for the explicit CLI/frontend,
output-helper, related test and documentation file set. Prettier 3.9.10 uses
its defaults; collector/domain files and generated lockfiles are not formatted.

## Run

Requires Bun and project dependencies. From this program directory:

    bun install --frozen-lockfile
    bun run typecheck
    bun test
    bun src/cli.ts list --archive "${ARCHIVE_DIRECTORY:?}"
    bun src/cli.ts collect --archive "${ARCHIVE_DIRECTORY:?}" --election 127492
    bun src/cli.ts collect --archive "${ARCHIVE_DIRECTORY:?}" --date 2026-11-03
    bun src/cli.ts status --archive "${ARCHIVE_DIRECTORY:?}"
    bun src/cli.ts verify --archive "${ARCHIVE_DIRECTORY:?}"

`ARCHIVE_DIRECTORY` is an operator-configured absolute, private, non-symlink directory outside the checkout; it is not a literal path. The collector refuses source-checkout storage. Original files, SQLite/WAL, HTTP headers and pending bodies remain there, never in source.

A duplicate ID `collect` verifies retained originals and returns existing coverage with zero HTTP. `Collector.collect(id, refresh)` remains compatible; `collectDate(date, refresh)` adds calendar selection. Leading zeroes in IDs are preserved. This is local reuse, not a remote freshness check. Use `--refresh` for a new bounded source observation and new byte versions; prior originals are not overwritten. A changed current-version token never becomes a path without literal digits validation. Before/after tokens and disagreement coverage remain explicit. No claim of immutable server content is made.

Calendar selection is mutually exclusive with ID selection. Invalid dates, rollover dates, timezone strings and path-like IDs fail before HTTP or archive opening at the CLI. Catalog dates are parsed explicitly as M/D/YYYY with optional ` 12:00:00 AM`; XML/settings dates use the same real-calendar parser, without `Date.parse` or timezone conversion. The selected date must agree across catalog, settings and XML, not just the election name. Ambiguous dates list matching IDs/labels; nonexistent dates list available catalog candidates. The native CLI preserves this guidance on stderr with status 1 and empty stdout, including literal leading-zero IDs; it suggests `--election` or `--refresh`. Only explicitly classified date-selection errors expose public catalog guidance (terminal controls escaped); unexpected/private failures remain generic. No result/version request is sent for an absent catalog ID or unresolved date.

Without `--refresh`, dates first consult the latest hash-verified retained catalog. An unambiguous matching completed/disagreement snapshot is verified and reused with zero HTTP, even after reopening. Missing or ambiguous dates in that retained catalog fail locally: use `--refresh` to obtain a fresh bounded catalog observation. If the catalog now assigns a different date to the same ID, the old snapshot is not relabeled or reused for that new date. With no retained catalog, or an unambiguous date without a completed snapshot, policy/catalog discovery precedes collection. A resumed checkpoint keeps its own catalog; refreshing the catalog index never invalidates the historical snapshot's original labels/dates, and checkpoint reuse cannot roll that index backwards.

The config requires published English and a positive integer template version (provenance, not a version allowlist); advertised languages, when present, must include English. Settings must bind the selected election and Travis entity 1239 and advertise XML. The adapter then validates the actual result-field schema, keys, counts, parallel arrays and cross-file identity online and offline. A compatible new template token is accepted; unsupported result/config schemas stop with an adapter-review error, without guessing another route.

## Transport and state

CivicClerk's existing complete-body serial HTTP queue and archive safety/promotion helpers are imported, not copied into a parallel runtime. Clarity adds SQLite attempt/checkpoint and source-specific validation. Its HTTP adapter retains non-2xx bodies inside the same queue; redirects remain manual and are rejected, not followed. Bun fetch disables decompression so original gzip transfer bytes and decoded JSON have separate hashes.

Each run persists its limits before traffic: 15 requests/files including attempts, 12 MB encoded per file, 20 MB cumulative retained transfer bytes, 8 MiB (8,388,608 bytes) decoded JSON/policy per file, 12 MB decoded ZIP, 32 MiB (33,554,432 bytes) uncompressed XML, 100 catalog entries, 1,000,000 normalized result rows. These finite defaults have countywide headroom, not old runoff-sample bounds; no unlimited override is provided. XML size is checked in ZIP metadata, decompression and direct parser input; row reservations stop at the ceiling before normalized rows are allocated. Full-body timeout is 120 seconds. Stream metering stops on the first over-limit chunk; that rejected chunk is not written. There is one in-flight transfer through body consumption, followed by at least three seconds before the next start. Up to four total attempts per acquisition, including interrupted/failed attempts across restarts; only transport/timeout, 408/429/5xx retry with bounded exponential delay and fresh jitter. Overall run ceilings still apply.

Robots and the official link page are checked before each network operation sequence. Known VoteTravis wp-admin-only robots policy is accepted; any other nonempty restriction, crawl delay or request-rate instruction stops for review. Clarity robots 404 is retained as absence, not a blanket authorization. The official page must still advertise the county Clarity URL. No hidden policy-link crawling occurs.

Retry-After seconds/date, exhausted standard/legacy reset headers and structured `r=0;t=...` cooldowns are persisted even on successful responses. Date calculations use the server Date when provided. Ambiguous instructions persist a stop gate; an operator must review the original headers before explicitly clearing it. Never reset cooldowns to evade a source instruction.

SQLite retains source identities, the latest retained catalog labels/event dates/full metadata per election, observations, runs, request attempts/HTTP headers/retrieval time, download and failure states, encoded/decoded hashes, normalized choice-vote-type-precinct rows and coverage. Unknown publication dates remain NULL. XML/report timestamps, source website-update settings, observation times and HTTP dates are separate representations. The catalog source dates are election dates, not publication dates.

Output creation uses exclusive files, symlink checks, a single-writer owned lock, fsynced bodies and atomic no-clobber hard-link promotion. A semantically invalid acquisition retains its uniquely named `.body.pending`; successful bytes become `.body`. Cross-file reconciliation is a later observation gate: files can be individually downloaded while the observation remains collecting/failed or disagreement. Never equate file download status with full observation completeness.

## Recovery

An existing `.civicclerk.lock` stops all new writers (the shared helper's name is intentional). After interruption, establish independently that its recorded PID/owner is no longer active before manually quarantining the stale lock. Do not remove another writer's lock or pending evidence. Reopen the archive: running runs and in-progress files become interrupted; good checkpoints must hash-verify before reuse. Resume with the same `collect` command; robots/link and the before/after token are freshly checked. No range/byte resume. A checkpoint version change stops; `--refresh` starts a new observation. Corrupt/missing retained downloaded files fail closed rather than silently replacing evidence. Review/quarantine damaged archives explicitly; no automated evidence deletion is provided.

## Reconciliation and evidence

The collector checks the single ZIP member/local/central metadata, CRC, bounded decompression, UTF-8 XML (including the optional standard UTF-8 ZIP filename flag), and forbids DTD/entities before parsing. XML IDs, duplicate keys, nonnegative counts and parallel JSON arrays are validated. Summary contest totals accept either one scalar count or a one-element count array; arbitrary arrays are unsupported, not summed heuristically. Choice precinct sums reconcile to vote-type totals, vote types to choice totals, choices to summary totals, and detail arrays by exact contest key, precinct labels and choice order. Summary/detail contest membership uses unique key sets, not presentation order; original array order is preserved. Turnout registered/ballot sums are reconciled separately; ballots are not candidate votes. All original source fields remain in raw files even when not normalized.

The implementation exercise used 12 serial live curl requests on 2026-11-06 for robots/official page/catalog and this one selected snapshot; it did not live-run the Bun transport. The retained original response bytes were then replayed through the actual collector with no HTTP. Version before/after was `367565`: 17 catalog entries, two contests, four choices, 31 turnout labels, 310 result rows, 53,766 registered, 7,212 ballots, 7,209 candidate votes; numeric reconciliations agreed. ZIP SHA-256: `7a602e2d2a4be10a0615f3b4cab102d32c7cd0e236610ee0501902a64c715a94`. Independent offline verification and duplicate reuse use zero HTTP. This is selected-snapshot coverage, not archive completeness.

`Official Results` is a source header, while final/canvass flags are false and precinct reporting fields differ. Raw settings and statuses are retained together; output certification is always `not established`. No certification or population/version-comparable audit conclusion is supported.

## Verification status

Chief acceptance exercised the default native public CLI on November 7, 2026: `--date 2026-11-03` selected catalog election `127492`, version `385566` stable before/after, and retained 223 contests / 188,180 rows in 12 requests. The observed minimum completion-to-next-start gap exceeded three seconds. Offline verification and both ID/date duplicate calls then succeeded with OS networking denied and no added requests. This is fresh public Bun transport proof, separate from the earlier curl acquisition and localhost replay. Independent source/code recheck passed; the older December 2025 archive still verifies and reuses by ID/date without migration. The genuine 2026 registered-total disagreement below remains explicit.

The multi-election revision is exercised under macOS OS-level outbound denial with localhost permitted for fixtures. All original tests remain, except intentional single-ID/fixed-template/fixed-size rejections now test malformed inputs or current finite bounds. Authored fixtures cover two coexisting elections (including a leading-zero ID), date/ID CLI selection, ambiguous/nonexistent/invalid dates, cached zero-HTTP reuse, catalog/settings/XML date binding, historical catalog updates and checkpoint resumption, supported/unsupported schemas, a 216,000-row countywide-shaped snapshot, and the native Bun reader-ownership regression. Exact commands and current receipts are retained privately for review rather than bundling originals into source.

Chief-acquired 2026 and 2024 originals were replayed as exact encoded bytes and original headers over native localhost HTTP, not acquired anew by the implementation worker. Both selected elections coexist and verify offline; duplicate ID and date reuse perform zero additional HTTP. The 2026 snapshot has 223 contests and 188,180 rows and preserves one genuine reconciliation flag (`registered total`: XML header 948,575 versus precinct/status sum 948,567); differing contest presentation order is not a key-set disagreement; the 2024 snapshot has 139 contests, 114,495 rows and no reconciliation mismatches. These are selected snapshots, not historical completeness, fraud evidence or certification; the real total flag is retained for source review, not interpreted as fraud or a certification decision. The native replay exposed an EOF/reader ownership failure; an authored large-page regression was RED before the narrow Tax/ArcGIS-pattern repair (lock reader before filesystem awaits, never cancel after EOF, always release/close with cleanup errors retained).

Focused remedy verification: 81 tests passed, 456 assertions, typecheck passed, including both contest-array permutations, missing/extra/duplicate keys, explicit reader cleanup and minimum positive template version 1. The earlier implementation run had 75 tests and 408 assertions. All four program source modules have 100% Bun line coverage (not a claim about imported sibling modules). Crapper measured 83 functions with maximum CRAP 9, all strictly below 10; dryer found no candidates at 0.8. Mutation current-form counters reconcile to 434 executed sites: 358 killed, 76 survived, 0 uncovered (82.5%, exit 3), not a zero-survivor pass.

Fresh Bun LCOV is used for crapper; the strict goal is every measured function below CRAP 10. Dryer uses 0.8. Full-source mutation execution is in a private common-root mirror after an unchanged-worker full-suite baseline. Mutation survivors are reported explicitly, not treated as a zero-survivor acceptance pass; the expensive countywide-shaped fixture is run in the full suite but excluded from repeated mutation workers. Independent chief review, backward-archive verification and final acceptance remain separate from these implementation receipts. No commit/push is performed by this worker.

## Development and limitations

### CLI discovery and delivery

`bun src/cli.ts --help`, `-h`, `help COMMAND`, and `COMMAND --help`/`-h`
are offline informational paths; `--version` reports the newly declared package
version 0.1.0 (also accepted after a command). No archive is opened for these
requests. Plain invocation prints useful help on stderr and retains exit 1.
Known value options consume their next token: a value spelling `--help` is not
help. `--` ends option parsing; following operands are not informational flags.
Explicit help bypasses unknown options, but malformed/missing option values can
still fail parsing. GNU equals/split string values and archive options around a
command work. Repeated options retain last-value-wins compatibility; collection
selection remains exactly one ID or date. There are no grouped short value
options, prompts, stdin archive support, color, or pager.

Normal pretty JSON bytes and domain statuses are unchanged. Native descriptor
writes check short writes and bound total delivery to five seconds, including
blocking pipes and nonblocking backpressure, without rerunning domain operations.
On timeout the native entrypoint terminates its pending output worker after a
safe diagnostic; it does not wait indefinitely for a non-reading consumer.
Non-EPIPE delivery failures now return 1 with a privacy-safe stderr diagnostic:
the prior silent success was incorrect. EPIPE is intentionally quiet and retains
the completed operation's status (normally 0); it does not assert that a consumer
received all output. Completed checkpoints remain retained, not rolled back.

Offline tests: set `TMPDIR` to a canonical existing private external scratch
directory. On macOS, run `bun test` under `sandbox-exec` with `(deny network*)`
and narrow localhost bind/inbound/outbound allowances for authored native
fixtures, as documented by the financial sibling's offline test command. Run
`bun node_modules/typescript/bin/tsc --noEmit` for typecheck. Generated probes,
coverage and dependency installation belong in an external execution mirror,
not this checkout. Retained-input replay is separate, not needed for CLI tests.

    bun test --coverage --coverage-reporter=lcov --coverage-reporter=text
    crapper --use-existing-coverage --threshold 10 src
    dryer --threshold 0.8 src

Tests use synthetic fixtures and local response adapters, not bundled source originals. Subprocess CLI tests are not counted as imported-module coverage. Mutation workers need the common `programs/` layout because shared helpers are imported; run them in an isolated private mirror and verify its unchanged baseline before trusting results. Quality scores and fresh independent review are acceptance evidence, not implied by successful functional tests. Native localhost and the bounded November 2026 public Bun transport are exercised; exhaustive server-policy grammar, hostile shared filesystem races and power-loss durability are not claimed verified. A stale lock requires operator recovery rather than unsafe automated lock stealing.
