# Clarity selected-election collector

Headless Bun/TypeScript + SQLite collector for the public Travis County Clarity file service. No server or scheduler. This is separate from the supervised county access recipe.

## Supported scope

- `list` / `discover`: one bounded catalog array (at most 100 entries), not exhaustive historical holdings.
- `collect` / `sync`: only explicitly selected `TX/Travis/125662`, English, template 345435, one source-derived current version, the five observed JSON files and advertised `detailxml.zip`.
- `status`: local SQLite state and the latest 20 run/coverage records.
- `verify`: offline SHA-256, gzip, ZIP CRC/XML, shared config/settings/XML identity validation, retained catalog/source/selection identity, exact file URLs/HTTP success states, reconciliation, normalized SQLite rows, integrity and foreign keys. No HTTP.

No version-history enumeration, guessed fallback routes, municipal IDs, voter data, authentication, cookies, challenges, certification inference or audit equivalence. Template, policy, identity or format changes fail closed and require adapter review. IDs and leading zeroes remain source-scoped strings.

## Run

Requires Bun and project dependencies. From this program directory:

    bun install --frozen-lockfile
    bun run typecheck
    bun test
    bun src/cli.ts list --archive "${ARCHIVE_DIRECTORY:?}"
    bun src/cli.ts collect --archive "${ARCHIVE_DIRECTORY:?}" --election 125662
    bun src/cli.ts status --archive "${ARCHIVE_DIRECTORY:?}"
    bun src/cli.ts verify --archive "${ARCHIVE_DIRECTORY:?}"

`ARCHIVE_DIRECTORY` is an operator-configured absolute, private, non-symlink directory outside the checkout; it is not a literal path. The collector refuses source-checkout storage. Original files, SQLite/WAL, HTTP headers and pending bodies remain there, never in source.

A duplicate `collect` verifies retained originals and returns existing coverage with zero HTTP. This is local reuse, not a remote freshness check. Use `--refresh` for a new bounded source observation and new byte versions; prior originals are not overwritten. A changed current-version token never becomes a path without literal digits validation. Before/after tokens and disagreement coverage remain explicit. No claim of immutable server content is made.

## Transport and state

CivicClerk's existing complete-body serial HTTP queue and archive safety/promotion helpers are imported, not copied into a parallel runtime. Clarity adds SQLite attempt/checkpoint and source-specific validation. Its HTTP adapter retains non-2xx bodies inside the same queue; redirects remain manual and are rejected, not followed. Bun fetch disables decompression so original gzip transfer bytes and decoded JSON have separate hashes.

Each run persists its limits before traffic: 15 requests/files including attempts, 12 MB encoded per file, 20 MB cumulative retained transfer bytes, 1 MB decoded JSON/policy, 100 KB XML, 100 catalog entries, 1000 normalized result rows. Full-body timeout is 120 seconds. Stream metering stops on the first over-limit chunk; that rejected chunk is not written. There is one in-flight transfer through body consumption, followed by at least three seconds before the next start. Up to four total attempts per acquisition, including interrupted/failed attempts across restarts; only transport/timeout, 408/429/5xx retry with bounded exponential delay and fresh jitter. Overall run ceilings still apply.

Robots and the official link page are checked before each network operation sequence. Known VoteTravis wp-admin-only robots policy is accepted; any other nonempty restriction, crawl delay or request-rate instruction stops for review. Clarity robots 404 is retained as absence, not a blanket authorization. The official page must still advertise the county Clarity URL. No hidden policy-link crawling occurs.

Retry-After seconds/date, exhausted standard/legacy reset headers and structured `r=0;t=...` cooldowns are persisted even on successful responses. Date calculations use the server Date when provided. Ambiguous instructions persist a stop gate; an operator must review the original headers before explicitly clearing it. Never reset cooldowns to evade a source instruction.

SQLite retains source identities, catalog source labels/event dates/full metadata, observations, runs, request attempts/HTTP headers/retrieval time, download and failure states, encoded/decoded hashes, normalized choice-vote-type-precinct rows and coverage. Unknown publication dates remain NULL. XML/report timestamps, source website-update settings, observation times and HTTP dates are separate representations. The catalog source dates are election dates, not publication dates.

Output creation uses exclusive files, symlink checks, a single-writer owned lock, fsynced bodies and atomic no-clobber hard-link promotion. A semantically invalid acquisition retains its uniquely named `.body.pending`; successful bytes become `.body`. Cross-file reconciliation is a later observation gate: files can be individually downloaded while the observation remains collecting/failed or disagreement. Never equate file download status with full observation completeness.

## Recovery

An existing `.civicclerk.lock` stops all new writers (the shared helper's name is intentional). After interruption, establish independently that its recorded PID/owner is no longer active before manually quarantining the stale lock. Do not remove another writer's lock or pending evidence. Reopen the archive: running runs and in-progress files become interrupted; good checkpoints must hash-verify before reuse. Resume with the same `collect` command; robots/link and the before/after token are freshly checked. No range/byte resume. A checkpoint version change stops; `--refresh` starts a new observation. Corrupt/missing retained downloaded files fail closed rather than silently replacing evidence. Review/quarantine damaged archives explicitly; no automated evidence deletion is provided.

## Reconciliation and evidence

The collector checks the single ZIP member/local/central metadata, CRC, bounded decompression, UTF-8 XML, and forbids DTD/entities before parsing. XML IDs, duplicate keys, nonnegative counts and parallel JSON arrays are validated. Choice precinct sums reconcile to vote-type totals, vote types to choice totals, choices to summary totals, and detail arrays by exact contest key, precinct labels and choice order. Turnout registered/ballot sums are reconciled separately; ballots are not candidate votes. All original source fields remain in raw files even when not normalized.

The implementation exercise used 12 serial live curl requests on 2026-11-06 for robots/official page/catalog and this one selected snapshot; it did not live-run the Bun transport. The retained original response bytes were then replayed through the actual collector with no HTTP. Version before/after was `367565`: 17 catalog entries, two contests, four choices, 31 turnout labels, 310 result rows, 53,766 registered, 7,212 ballots, 7,209 candidate votes; numeric reconciliations agreed. ZIP SHA-256: `7a602e2d2a4be10a0615f3b4cab102d32c7cd0e236610ee0501902a64c715a94`. Independent offline verification and duplicate reuse use zero HTTP. This is selected-snapshot coverage, not archive completeness.

`Official Results` is a source header, while final/canvass flags are false and precinct reporting fields differ. Raw settings and statuses are retained together; output certification is always `not established`. No certification or population/version-comparable audit conclusion is supported.

## Verification status

Final narrow-fix local run: 60 tests passed, 329 assertions, TypeScript typecheck passed under OS network denial. Fresh Bun LCOV plus crapper measured a maximum CRAP of 9 over 70 measured functions (all strictly below 10); dryer at 0.8 reported no duplicate candidates. Source-module line coverage was 100% for CLI/results/source and 99.59% for collector. The aggregate includes imported sibling code that this program does not exercise; it is not a full shared-client coverage claim.

Independent review reproduced two defects before repair: structured cooldown whitespace was lost across restart, and offline verification accepted election/URL misattribution. Regression tests were RED before the fixes. The persisted parser now recognizes the shared queue's accepted structured whitespace forms and refuses exhausted-quota reset ambiguity. Online/offline config, settings and XML identity checks are shared. Offline verification binds retained catalog/source/selection metadata, before/after tokens, all successful same-name checkpoint URLs and HTTP/MIME states, coverage/status and normalized rows. It detects independently altered metadata, not an adversary rewriting every original and all hashes coherently.

Boundary tests now exercise request 15 acceptance/16 refusal, cumulative 20 MB including failed bodies and a rejected overflow chunk, exact per-file transfer cap, positive matching and malformed/mismatched Content-Length, nonzero jitter attempt timings/restart, immediate successful/error cooldown restart at a nonzero clock, fresh policy gates on the same incomplete observation, default Bun.fetch with `decompress:false`, positive main collect/sync, CRC-valid malformed UTF-8, XML string preservation and matching unsupported ZIP flags/method.

Current-source mutation testing in a private common-root mirror verified passing baseline/unchanged workers, then executed all 359 sites with two workers: 301 killed, 58 survived, 0 excluded as uncovered, 83.8%, exit 3. `--no-coverage` deliberately selected all sites. Current `:forms` counters reconcile with the executed total. This is not a zero-survivor acceptance pass. The identical request/file caps are redundant; normalized-row equal-key ordering, null/empty header fallbacks, forced XML array nullish fallbacks and equal-length representative selection have equivalent mutants. Remaining survivors are retained for review, not blanket-waived or forced away by changing semantics. Independent recheck of these fixes and chief-owned county inventory updates remain pending. No commit or push was made.

## Development and limitations

    bun test --coverage --coverage-reporter=lcov --coverage-reporter=text
    crapper --use-existing-coverage --threshold 10 src
    dryer --threshold 0.8 src

Tests use synthetic fixtures and local response adapters, not bundled source originals. Subprocess CLI tests are not counted as imported-module coverage. Mutation workers need the common `programs/` layout because shared helpers are imported; run them in an isolated private mirror and verify its unchanged baseline before trusting results. Quality scores and fresh independent review are acceptance evidence, not implied by successful functional tests. Live Bun transport, exhaustive server-policy grammar, hostile shared filesystem races and power-loss durability are not claimed verified. A stale lock requires operator recovery rather than unsafe automated lock stealing.
