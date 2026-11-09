# County document collector

Bun/TypeScript and SQLite-backed, private HTML/PDF acquisition with four explicit source adapters sharing one engine, transport and archive lock. LLM-assisted implementation. Independent source semantics and runtime integrity rechecks passed; supported scope and operating limits are below. No deployed web server, scheduler, credentials or JSON-manifest state.

## Setup

Use Bun 1.3+ and Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`). Bun installation: https://bun.sh/docs/installation ; install Poppler through your platform package manager. From this program directory:

    bun install --frozen-lockfile
    bun test
    bun run typecheck
    bun run src/cli.ts help

The program imports existing CivicClerk archive/complete-transfer queue primitives. Run it within this repository rather than copying this directory alone. Source-specific policy, durable attempts, cooldowns and compression accounting are enforced here, not assumed to be supplied by the shared queue.

## Private archive and bounded selection

Set `ARCHIVE_DIRECTORY` to one operator-approved canonical absolute private directory outside the checkout. Ancestor symlinks are rejected. Use ONE trusted archive/writer across these sources; parallel archive roots are not a supported way to reset or coordinate budgets. All original HTML/PDFs, encoded wire bodies, headers, images, SQLite and checkpoints remain private. Never publish or index originals, especially historical minutes carrying noindex/noarchive/nosnippet instructions.

`list`, `verify`, `collect` and `sync` require `--source` and a finite `--limit`. Filters `--year`, `--chapter`, `--date`, `--role` and `--url` match discovered tokens exactly. Supported years/chapters derive from actual source links, not the verification sample. Malformed/conflicting source dates remain unresolved with original tokens and headings preserved; filenames are never guessed or silently repaired. URL selection deduplicates identity while SQLite retains every label occurrence.

    bun run src/cli.ts list --root "$ARCHIVE_DIRECTORY" --source county-code --chapter 2 --limit 1
    bun run src/cli.ts status --root "$ARCHIVE_DIRECTORY"
    bun run src/cli.ts verify --root "$ARCHIVE_DIRECTORY" --source county-code --chapter 2 --limit 1

Offline imports support retained bodies and original headers:

    bun run src/cli.ts import-page --root "$ARCHIVE_DIRECTORY" --source county-code --page https://www.traviscountytx.gov/commissioners-court/county-code --input "$RETAINED_HTML" --headers "$RETAINED_HEADERS" --origin retained-original
    bun run src/cli.ts import-pdf --root "$ARCHIVE_DIRECTORY" --observation "$OBSERVATION_ID" --input "$RETAINED_PDF" --headers "$RETAINED_PDF_HEADERS" --origin retained-original

`--headers` is optional when genuinely absent, not invented. Headers are retained exactly and hashed; raw Set-Cookie or other response fields remain private, never replayed. Retained origins are explicit operator assertions, not fabricated HTTP success or retrieval timestamps. Original retrieval time is null when unknown; import time, source dates, PDF metadata and HTTP Date/Last-Modified remain separate evidence. Input files, including headers, reject resolving/dangling symlinks and oversized bodies.

## Discover, collect and revision checking

    bun run src/cli.ts discover --root "$ARCHIVE_DIRECTORY" --source budgets --page https://www.traviscountytx.gov/planning-budget/current-year --allow-network
    bun run src/cli.ts collect --root "$ARCHIVE_DIRECTORY" --source budgets --year 2027 --role taxpayer-impact --limit 1 --allow-network
    bun run src/cli.ts verify --root "$ARCHIVE_DIRECTORY" --source budgets --year 2027 --role taxpayer-impact --limit 1

`discover` accepts only the dedicated reference routes. `collect` locally re-verifies downloaded selections without HTTP; `sync` explicitly requests a new byte observation, within the SAME durable limits. Neither local reuse nor offline verify detects remote changes. Different hashes retain immutable prior versions and each observation's validation receipt. Zero automatic retries is the deliberately bounded retry policy; redirects are recorded failures with no automatic fanout. No forms, registration, purchases, records requests, cookie borrowing or challenge bypass.

Conservative ceilings per trusted archive, INCLUDING all earlier runs and failures:

- 24 HTTP attempts; 20 MiB combined known wire bytes plus full unknown-wire reservations.
- 2 PDF attempts/source; 5 MiB maximum for BOTH wire and decompressed PDF content.
- 3 MiB wire/decompressed metadata page; aggregate 2000 discovered document occurrences across the source's latest pages.
- Discovery attempt counts: budget 3 reference pages; County Code, minutes and election publications 1 each. A new run does not reset them.
- One in-flight complete body; at least two seconds completion-to-next-start globally across these sources, with stricter robots/server waits persisted even on HTTP 200.

Robots is fetched before first authority access and retained for this bounded observation. Its conservative union of disallow groups can reject otherwise allowed paths; request-rate/ambiguous instructions require review. Server Retry-After, standard/legacy quota resets and structured RateLimit whitespace are handled conservatively; unknown instructions stop rather than grant permission. Broader recurring monitoring/budget renewal requires a separately reviewed policy, not deletion of SQLite.

Native Bun fetching explicitly uses `decompress:false`. Identity, gzip and Brotli responses retain separate wire/decoded artifacts, hashes and byte counts. Content-Length is checked against encoded bytes; wire consumption and decompression output are independently bounded. Unsupported encoding, malformed length, size overflow, challenge or unresolved cooldown fails closed. Failed/unfinished attempts keep conservative reservations and a durable stop gate.

The initial robots request encountered the old transparent-decompression classifier defect. That failed receipt remains unchanged. After local retained-body/compression and native Bun loopback regression tests, an explicit authorized resolution adopted the retained robots policy and recorded the previous gate/reason. The old representation is honestly `legacy-decoded-only`: original encoded hash/byte count remain unknown, with a full reservation. New observations retain both representations; no robots refetch was used to test the repair.

## Source adapters and date semantics

- `budgets`: enclosing full fiscal-year headings and actual category/volume/language labels; official PDFs outside planning-budget directories are eligible. Fiscal and tax years are separate nullable fields; the small actual sample identifies FY2027/tax2026 and discusses a proposed budget. Preserve conflicting PDF title/body/page labels and original filename revision tokens. No financial interpretation.
- `county-code`: sparse current chapter links with title/subtitle context, never generated numbers. Title 30/footer PDFs and historical selector bodies excluded initially. The online code is reference-only, not the Clerk's official paper record or legal advice. Body "Amendments added through" and "Chapter ... was amended" dates are separate scoped fields, not blanket effective/publication dates.
- `meeting-archives`: links inside closed static accordions retain original year/month/anchor/session evidence. Malformed `1.25.1000` and filename/date disagreements are not repaired. No invented CivicClerk IDs or claim about archive/boundary completeness. The actual 2010 sample's title says January 5 while its opening sentence says January 2; original bundled bodies and conflict remain intact.
- `election-documents`: same-page election sections and actual direct PDFs. Administering county is not inferred to be every contest jurisdiction. Role, official/unofficial/unknown state, election date, report/attestation date and unknown publication date remain distinct. No Clarity extraction, voter data, inferred certification or discrepancy allegations.

PDFs require expected MIME, magic, byte bounds, Poppler parsing and scoped body identity: a leading chapter title, a minutes meeting title with the exact full date plus Commissioners Court/session text, or the leading explicit fiscal-year identity (not an incidental tax/comparison year). The minutes title controls the selected meeting date; conflicting opening prose remains unmodified evidence, not a repaired date. Budget role and readable election role/date/state must also agree with the selected source evidence. New validation receipts use schema 4 and `identityPolicy: scoped-title-v1`; verification re-evaluates strict identity for older text receipts too, without rewriting them. Text extraction examines only the first three pages and is an identity aid, not structured financial/election interpretation. Unrecognized/ambiguous titles require private review rather than successful automatic import. Body metadata parsing is narrowly scoped to explicit fiscal/tax/amendment/report phrases; unparsed dates remain null. PDF creation/modification and HTTP metadata are retained separately, not promoted to publication dates.

## Explicit one-page rendered review

Empty/corrupt text is not silent success. The actual reconciliation sample is image-only: its original remains retained when automatic text identity fails. A trusted reviewer can inspect its one-page rendering and submit an explicit offline identity assertion. This is not whole-corpus OCR or an unattended rendered-acceptance service.

Using an approved private render prefix with no existing output and no concurrent writer:

    pdftoppm -f 1 -l 1 -singlefile -scale-to 1400 -png "$RETAINED_PDF" "$PRIVATE_RENDER_PREFIX"
    bun run src/cli.ts review-pdf --root "$ARCHIVE_DIRECTORY" --observation "$OBSERVATION_ID" --input "$RETAINED_PDF" --image "$RENDERED_PNG" --review "$PRIVATE_REVIEW_JSON" --headers "$RETAINED_PDF_HEADERS"

The review JSON is operator input, not persistence/queue state. Fields: `documentSha256`, `imageSha256`, `county` (Travis), exact discovered ISO `date`, `role`, `state`, nullable `originalAttestationDate` and `attestationDate`, and a nonempty `note` recording actual visual evidence. The engine requires one physical page, binds the supplied image to a fresh deterministic rendering of the exact original, and stores the assertion/image hash in SQLite. No contest jurisdictions or election totals are inferred. Verification rerenders and rechecks document/image/selection/body receipt consistency. The sample retains original `6.21.22` separately from reviewer-confirmed `2022-06-21`.

## Integrity, completeness and fail-closed recovery

SQLite stores sources, observations, immutable snapshots, versions/history, per-history validation receipts, runs, attempts, cooldowns, imported headers, wire representations and artifact checkpoints. Hash-named artifacts are promoted with same-filesystem hard links, never overwrite. A checkpoint records expected hash/size and owned partial name before output; database completion follows required artifact promotion. A failed group does not acquire a false completed-selection result: `verify` rejects any selected missing/failed document or incomplete snapshot.

Zero-HTTP verify checks required schema/version markers, SQLite integrity/FKs, every promoted checkpoint AND each required artifact's exact promoted path/hash/size (PDF, snapshot, wire/decoded body, candidate and rendered image), exact reparsed source inventories and snapshot counts/headers, bidirectional observation/version/history identity, validation-receipt hashes/schema/selection, PDF bytes/parser results, and rendered evidence where applicable. Transport attempts and representations/resolutions are checked in both directions, including known wire accounting, original legacy classifier failure identity and full unknown-wire reservations; unknown failed/inflight bodies require a stop gate. Budget checks refuse damaged accounting before another request. Missing files, removed observations, orphan versions or coordinated metadata/receipt drift fail. Legacy normalization and validation receipts are retained/versioned rather than silently rewritten.

Fresh archives initialize archive schema 3 once, including all three transport tables, even for offline-only imports. The required cooldown contract includes `id`, `not_before` and `blocked`, with exactly one row at id 1. Its persisted timestamp must be a nonnegative safe integer (therefore finite); `blocked` is either null or a nonempty, non-whitespace string. Opening, offline verification and transport gates validate this same state before requests or budget changes. Missing columns, ambiguous text/numeric values, invalid stop reasons or missing/extra rows fail closed without resetting, coercing or repairing the durable wait. Distinct transport instances share the completion-to-next-start wait, including time spent consuming the entire body. Existing archives must already contain the full schema; neither opening nor constructing transport recreates missing established tables. Schema 2 and earlier archives require a separately evidenced, manual migration on a private backup. There is no automatic migration/repair CLI. Recover missing transport state from prior durable evidence or refuse continuation; a version-marker update alone is not a migration.

Genuinely pre-checkpoint artifacts require individually reviewed rows in `legacy_artifacts(path,sha,bytes,evidence)`, never a blanket missing-checkpoint waiver. The JSON evidence records `kind: pre-checkpoint-artifact`, exact `path`, `sha`, `bytes`, a `priorArchiveSha256` and a nonempty `reason` identifying the independently preserved prior provenance. Keep that prior archive/evidence private and available for review. These are trusted operator migration assertions, not cryptographic proof of historical truth. Do not create exemptions for lost modern checkpoints, reconstruct checkpoints from arbitrary current finals, or run a generic enumerate-and-bless migration. An existing invalid checkpoint cannot be overridden by an exemption. Verification and artifact reuse never create receipts. The bounded historical sample required 12 individually evidenced pre-checkpoint exemptions on a copied archive; the original archive remains unmigrated and intentionally refuses this version until chief-approved migration.

The shared `.civicclerk.lock` protects the whole archive. Existing locks stop another writer. After interruption, do not automatically remove locks, erase attempts, reset reservations, overwrite finals or append partials. First confirm the recorded writer is stopped and preserve a private archive backup. An unfinished artifact checkpoint makes reopening fail closed; use its ORIGINAL expected hash/size/partial name for manual forensic reconciliation. Do not rehash arbitrary finals to invent a new checkpoint or promote only part of the required evidence. Unknown wire outcomes likewise require explicit operator review; no automatic recovery/reset command is provided. This is honest manual recovery, not byte-range resume or an automated crash-repair guarantee.

## Actual exercised scope

The bounded implementation exercise used 6 total source attempts including the initial failed classifier receipt: county robots, one current budget page/PDF, VoteTravis robots and one election page/PDF. No further public requests were needed for County Code/minutes retained-original validation. One small PDF per live source, no large adopted budget download.

| Sample | Bytes | SHA-256 |
| --- | ---: | --- |
| FY2027 taxpayer-impact statement | 127112 | `566b43f130ab8395088d566edd6df788a99322a3c385c758b536d4ed4321f5a3` |
| June 11, 2022 official reconciliation (image-only) | 24807 | `d694dfc8a549dd42c8cbade09a8046d5fc19f3929c53cb1b4686171cb7df2156` |
| Current reference Chapter 2, retained | 247899 | `12e09fbf334455d038aade4cba3a7a6e9ff54b790aef1f8953067d6ceddbc806` |
| Current reference Chapter 464, retained | 411612 | `bb112d2ca93a32a96c05185bbcf585596067ce59722b12f0ed621ed1953bac6a` |
| January 5, 2010 minutes, retained | 119994 | `3cdb0b3a0f7e11e90ac493dc56c913516c1c3e4c38077c4d5ce6918a873c4269` |

Retained inventories reproduced 80 occurrences/80 unique current chapter URLs and 988 occurrences/987 unique historical minutes URLs. These are observed link inventories, not all-documents availability or archive completeness. All five selected originals passed offline verification; duplicate imports and local changed-byte fixtures retained correct versions.

Tests exercise compression/length/decompression bounds, exact-source and schema/receipt corruption, aggregate link limits, saved headers, symlinks, writer collision, interruption/reservation/restart and fail-closed checkpoint states. Tests/coverage run with outbound network denied except explicit loopback compression fixtures. Own-function CRAP is strictly below 10 and dryer reports no candidates at 0.8. Scoped encoding mutation testing includes unchanged-worker and known-defect controls; it is not a whole-engine mutation claim. Independent source and runtime rechecks passed; the final suite has 71 passing tests and typecheck passed. No public raw evidence is shipped.
