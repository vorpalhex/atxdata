# arcgis-consume

A bounded, read-only ArcGIS library and headless Bun/TypeScript CLI. One adapter has two configurations:

| Source | Supported acquisition |
| --- | --- |
| `tnr` | Named Travis County Commissioner Precinct polygon layer; authoritative before/after counts and IDs, ordered pages of two, five selected attributes and native geometry |
| `voter` | Already-published Election Precincts item ZIP; six original components, reconciled SHP/SHX/DBF identities and polygon geometry |

`discover` reads only one current hub catalog page. It does not acquire the features behind catalog results. In particular, catalog inclusion does not authorize collecting address points, owners, surveys, forms or individual voters. No editing, authentication, export job, generalized URL input, scheduler, server or unbounded backfill is supported.

## Readiness

The named TNR and published ZIP strategies were exercised against their public sources by the prior implementation, and both retained collections pass current-code zero-HTTP verification. This is not yet approved for unattended operation: fresh independent recheck is pending. The prior live TNR discovery failed with an intermittent native stream `TypeError: undefined is not a function`; its failed run and raw evidence remain unchanged and its source budget is exhausted. Current reader-ownership cleanup was checked using repeated subprocess replays of the exact retained site-data body over localhost, not new public acquisition. A later single, separately capped diagnostic had acquired that body but was not a completed catalog search. TNR catalog search remains unvalidated live. Voter discovery previously completed with 16 catalog items. Do not treat the older reference's TNR catalog count as this implementation's live result.

## Install and commands

Run from this directory in the repository; sibling CivicClerk/Legistar modules are required. Bun 1.3.14 was used. Project dependencies are pinned in `bun.lock`.

```sh
bun install --frozen-lockfile
bun src/cli.ts list

# ARCHIVE must be an absolute, private directory outside the checkout,
# without symlinks in any path component. The caller chooses its location.
: "${ARCHIVE:?Choose a private archive outside source}"
bun src/cli.ts rules --source tnr --archive "$ARCHIVE"

# Review current robots and the item's disclaimer/description in rules output.
# TERMS_SHA256 is the exact hash of that reviewed usage metadata, not a token.
: "${TERMS_SHA256:?Copy the reviewed rules output hash}"
bun src/cli.ts discover --source tnr --archive "$ARCHIVE" --terms-sha256 "$TERMS_SHA256"
bun src/cli.ts collect --source tnr --archive "$ARCHIVE" --terms-sha256 "$TERMS_SHA256"
bun src/cli.ts status --archive "$ARCHIVE"
bun src/cli.ts verify --archive "$ARCHIVE"
```

Use `--source voter` with its separately reviewed terms hash for the published-file strategy. An approved terms hash can be supplied to an unattended invocation: robots are rechecked per new run, and changed item usage metadata stops rather than silently accepting new conditions. A disclaimer's acceptance is not a legal-boundary, currency, surveying or election-validity conclusion.

`collect` verifies and reuses the newest successful collection for that source without HTTP. It is not an update check. `sync` explicitly creates a fresh bounded observation, preserving previous byte versions. `rules` and `discover` also create new bounded runs. After a failed/interrupted run, `--resume RUN_ID` reuses that run's verified checkpoints and cumulative budget; it is not a way around the request ceiling. Missing robots files (HTTP 404) are recorded as absent rules, not challenges; other errors stop. A resumed run may re-request an absent robots file because no successful body checkpoint exists for its 404.

The library exports `Archive` and `Adapter` from their source modules. `Archive.open` accepts an injected transport/clock for isolated tests; production CLI routes are fixed by the two source configurations.

## Bounds and transport

Every run has ceilings of 25 HTTP attempts including retries/redirects, 5,000,000 bytes per metadata response, 20,000,000 received body bytes total, and a 45-second transfer deadline. TNR collection permits 1–10 rows in pages of two. Discovery permits one page of at most 100 items and requires exact totals, distinct IDs and `nextStart=-1`. The ZIP permits 1,000,000 compressed bytes, exactly six named components, at most 2,000,000 declared and actual expanded bytes, and 1–1000 geographic records. Current observed counts are evidence, not immutable expectations.

Only one transfer is allowed in flight, including complete successful body consumption. The completion-to-start gap is at least two seconds, or stricter robots crawl-delay. The existing `PoliteHttpClient` handles timeouts and serial full-transfer ownership; the adapter adds persisted pacing, request/byte bounds, an attempt ledger and strict server-header interpretation. Cooldowns on successful responses are honored too: Retry-After seconds/date with server Date, exhausted relative RateLimit reset, exhausted epoch X-RateLimit reset, and structured RateLimit policies. Uninterpretable headers persist a manual-review stop. Server cooldowns are not capped. Transient HTTP/network errors get at most two retries per invocation with exponential delay and jitter; resuming restarts that local retry loop but never resets the cumulative 25-attempt run ceiling. ArcGIS JSON errors inside HTTP 200, schema errors, challenges, permanent statuses and byte limits stop.

Native fetch does not import browser cookies or credentials. Redirects are manual. Only the named published-item entry may yield an HTTPS `www.arcgis.com/itemdata/.../Election_Precincts.zip` redirect. Its signed URL and raw response headers remain private temporary access material, never a source identity. The permanent entry URL is stored separately in `sources.original_url`. There is no arbitrary redirect following or catalog-wide traversal.

## State, originals and recovery

`state.sqlite` stores source identities/labels/original URLs, runs, every attempt, headers, retrieval timestamps, bytes, hashes, durable cooldowns, checkpoint/download status and byte-version history. Before wire activity, each attempt durably charges its full allowed body bytes (the lesser of its response limit and remaining run budget). While `finished` is NULL, `attempts.bytes` is that conservative reservation, not a measured received count; clean completion/failure reconciles it to measured bytes. Process death retains the entire reservation and any abandoned partial/provenance. Legacy unfinished zero-byte attempts have unknown consumption and block further budgeting for manual review; they are not automatically reset. The cumulative byte budget may therefore stop conservatively before measured consumption reaches 20MB. Raw ArcGIS created/modified assertions remain in original item metadata; HTTP Date/Last-Modified remain HTTP provenance. Publication dates are explicitly unknown, not inferred from retrieval, approval text, item modification or feature-editor dates.

The adapter imports the existing CivicClerk archive lock, symlink guard and no-clobber hard-link promotion, plus the Legistar streaming writer. Shared files were not changed. Originals are written to UUID paths, streamed under a byte ceiling, validated and fsynced, checkpointed as pending, promoted without overwriting, then marked ready. Every changed byte version gets a new original path; existing originals are not rewritten. An interruption after the pending checkpoint is recovered by validating the same hash/size and finishing promotion offline. Uncheckpointed failed `.pending` files are never accepted as complete. The shared writer removes incomplete `.part` output on a failed stream; its attempt/error/received-byte status remains, but failed stream bytes are not a retained original.

The common writer lock is `.civicclerk.lock` because it is deliberately reused, not reimplemented. A second writer fails. A process crash can leave a stale lock. Establish independently that the recorded PID and all transfers have exited; inspect attempts, partials, checkpoints and persisted cooldown before an operator removes that stale lock. There is no automatic lock stealing, partial append or byte-range resume. Do not remove a lock belonging to a live process.

`verify` uses no HTTP: SQLite integrity/foreign keys, all retained checkpoint sizes/hashes, bidirectional observation/version-history identity (source, label, hash, size and retained representative path/retrieval/run source), and semantic reconciliation of completed collections are checked. Missing ready history is rejected, not recreated. A failed/incomplete discovery remains explicitly failed even if retained metadata verifies. Verification does not claim archive completeness merely because local files are sound.

## Geometry and file semantics

TNR metadata and original response bodies are retained verbatim, including full native SR, units, tolerances, extents, fields and capabilities. Native `wkid=102739`, `latestWkid=2277` is state-plane feet, not longitude/latitude. Rings must be nonempty, closed, XY-only and finite, within the layer extent with a 0.01-unit rounding allowance. Every selected field's name/type/alias is checked against layer metadata. Before/after counts and unique ID sets must agree with exactly one occurrence of every acquired record. Transfer flags and expected page lengths are checked independently of ID reconciliation.

Catalog/service identities remain distinct, including TNR's mismatching advertised serviceItemId. No inaccessible item identity is guessed or repaired, and `/0` is never appended to catalog URLs. The one supported TNR layer URL is an explicit verified configuration.

The ZIP is not extracted to server-controlled filesystem paths. Exact names, duplicate/member count, encryption/symlink flags, CRCs, declared/actual expansion limits, native PRJ/CPG, full field names, SHP/SHX indexing, DBF counts, unique Precinct values, finite polygon coordinates and ring closure are validated. All original components remain inside the unchanged ZIP, including private publisher/editor attributes. File and service equal counts do not establish equal identities, geometry or versions. No comparison with voter live-service features is claimed.

## Verification evidence

A small public sample on 2026-11-06 produced four TNR polygons, IDs 5/6/7/8 across two pages, and a 308-record/six-component ZIP with 308 rings and 65,699 vertices. TNR count/ID/schema/native-SR checks and published item before/after metadata checks agreed. These are the two named observations, not a county-wide or historical archive.

Original TNR page hashes (277433 and 323135 bytes):

- `4d151fb29b4891d07feb284c152dafbb13ad382cc99a443ac7348c430d037897`
- `a2e9e6186f4746301276e06ad76bd5c63dfc2c05aed68bf6de880869fb0910f9`

Original ZIP: 656459 bytes, SHA-256 `108837b38a9f913740577b5ab0784c40022df20ea0e00930b56ba0b9bb145c41`.

An offline audit verified 28 observation checkpoints and two completed collections, integrity `ok`, no foreign-key errors. Duplicate `collect` invocations reused both run IDs; the attempt count remained 36 before/after and an injected network-denial transport was called zero times. The ledger includes one local pre-network budget rejection; real public responses were 25 for TNR including the separate initial robots probe, and 12 for voter. No further traffic is authorized by that exhausted sample budget.

Tests use synthetic local fixtures (never presented as acquired source data), local HTTP/gzip/Brotli/TLS servers, and injected transports/clocks. Set `TMPDIR` to an approved private scratch directory without symlink components before testing; a default macOS path through a symlink is intentionally rejected.

```sh
bun test --coverage --coverage-reporter=lcov --coverage-reporter=text
bun run typecheck
crapper --use-existing-coverage --threshold 10 src
dryer --threshold 0.8 src
```

Prior implementation evidence (not a fresh run of the fixes): 31 tests passed, 0 failed; typecheck passed; every measured new-source function had CRAP below 10 (maximum 9). Bun's aggregate coverage includes imported sibling collectors and excludes subprocess CLI coverage; it is not a blanket coverage claim for those existing clients. Dryer reported one score-0.80 SQL lookup-shape candidate (`latestCollection` vs `budget`); newest successful collection selection and run request/byte aggregation are semantically different typed SQL queries, not duplicated policy. No generic wrapper was extracted to game similarity. Prior mutation testing in a private repository-layout mirror killed all 95 sites in `cooldown.ts` and `geometry.ts`, with 0 survivors/uncovered, after an unchanged worker baseline passed. That prior result excludes the changed reader, reservation and history logic and is not a whole-program mutation score. Fresh independent recheck remains chief-owned and outstanding.

Narrow-fix evidence is offline/local only: repeated exact-original 37,549-byte site-data replays completed 200 acquisitions across ten subprocesses without retries, detached errors or status/hash/count disagreement. The crash regression actually exits a child after a 4MB partial, verifies its dead PID before clearing only its owned stale lock, and resumes with the full 5MB reservation still charged. Corruption tests reject missing/mismatched version history without HTTP or silent repair. The fix suite passed 40 tests and typecheck; fresh CRAP remained below 10 (maximum 9), and Dryer found no current candidates at 0.8. Targeted mutation testing executed and killed 20 selected sites across reader lifecycle, verification, output paths and byte reservations/history, with zero survivors/uncovered in that selection, after an unchanged worker baseline passed; this is not all 111 potential sites in those files or whole-program mutation coverage. Source acquisition remains frozen; none of these checks completes the live TNR catalog search.
