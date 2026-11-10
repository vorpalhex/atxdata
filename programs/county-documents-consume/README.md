# County document collector

Bun/TypeScript and SQLite-backed, private HTML/PDF acquisition with four explicit source adapters sharing one engine, transport and archive lock. LLM-assisted implementation. The original implementation received source/runtime rechecks; this source-wide repair still requires independent review. Supported scope and limits are below. No deployed web server, scheduler, credentials or JSON-manifest state.

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

`discover` starts at a reference route or a URL evidenced by an already retained source link. It follows only relevant links within dedicated source paths, not arbitrary same-host navigation, and returns `complete` plus `pending` when the page budget ends. Resume with an exact pending `--page` in a later authorized operation; prior snapshots remain available. Already retained nested pages are not refetched automatically; select their exact URL for refresh. Request/byte exhaustion fails explicitly after preserving completed snapshots. `catalog --source SOURCE` lists latest retained page links, raw selector labels/values, and blocked original hrefs without network access. Selectors are evidence, not invented GET endpoints. `collect` locally re-verifies downloaded selections without HTTP; `sync` explicitly requests a new byte observation within this operation’s work budget. Neither local reuse nor offline verify detects remote changes. Different hashes retain immutable prior versions and each observation's validation receipt. Zero automatic retries is the deliberately bounded retry policy; redirects are recorded failures with no automatic fanout. No forms, registration, purchases, records requests, cookie borrowing or challenge bypass.

Explicit positive-safe-integer work budgets, per authorized CLI operation (or `Transport` instance), not per archive lifetime:

- `--max-requests N`: default 100 HTTP attempts including robots and failures.
- `--max-bytes N`: default 536870912 (512 MiB), combined known wire bytes plus full unknown-body reservations. A complete transfer releases unused reservation only within its operation. Imports also honor this aggregate body budget; rendered review includes PDF plus supplied image bytes.
- `--max-pdf-bytes N`: default 134217728 (128 MiB) for both wire and decompressed PDF content. The same bound is available to import, review, collect and sync, not a 5 MiB blockade. Library callers set `Engine.open(root,{maxPdfBytes})` and pass matching `Transport` work options; a transport cannot exceed its engine’s bound.
- `--max-pages N`: default 50 metadata pages per discovery traversal. No fixed reference-page attempt count and no two-PDF/source quota.
- Metadata remains at most 3 MiB wire/decoded per page and 2000 document occurrences across a source’s latest pages. Selection remains explicitly bounded at 2000; these are safety bounds, not a verification-year allowlist.
- One complete body in flight; at least three seconds completion-to-next-start globally across these sources. Stricter robots/server waits persist even on HTTP 200.

Each document/page is persisted before continuing the batch. Individual encoded/decoded PDF bodies are finite-buffered, not a constant-memory stream-to-disk implementation; the streamed fixture exercises chunked input and full-body bounds. Do not infer unlimited-size support. Increase finite work limits only with operator authorization; published defaults are not permission to exceed an assigned public-request group ceiling. Old attempts, unknown-wire reservations, server cooldowns, robots and stop gates remain global and are never deleted/reset by a new operation.

    bun run src/cli.ts collect --root "$ARCHIVE_DIRECTORY" --source budgets --year 2027 --role adopted --limit 1 --max-pdf-bytes 134217728 --max-bytes 268435456 --max-requests 8 --allow-network

New transport runs carry versioned operation/limit/reservation receipts in the existing run-kind field. Verification binds reservations to these receipts and checks grouped operation totals. Legacy attempts keep their exact historical full reservations (including unknown wire facts); no schema3 tables or old rows are migrated or rewritten.

Robots is fetched before first authority access and retained for this bounded observation. Its conservative union of disallow groups can reject otherwise allowed paths; request-rate/ambiguous instructions require review. Server Retry-After, standard/legacy quota resets and structured RateLimit whitespace are handled conservatively; unknown instructions stop rather than grant permission. Recurring scheduling remains out of scope; explicit continued acquisition is supported without deleting SQLite or evading server policy.

Native Bun fetching explicitly uses `decompress:false`. Identity, gzip and Brotli responses retain separate wire/decoded artifacts, hashes and byte counts. Content-Length is checked against encoded bytes; wire consumption and decompression output are independently bounded. Unsupported encoding, malformed length, size overflow, challenge or unresolved cooldown fails closed. Failed/unfinished attempts keep conservative reservations and a durable stop gate.

The initial robots request encountered the old transparent-decompression classifier defect. That failed receipt remains unchanged. After local retained-body/compression and native Bun loopback regression tests, an explicit authorized resolution adopted the retained robots policy and recorded the previous gate/reason. The old representation is honestly `legacy-decoded-only`: original encoded hash/byte count remain unknown, with a full reservation. New observations retain both representations; no robots refetch was used to test the repair.

## Explicit enCodePlus robots acknowledgement (partial historical workflow)

`--human` is a boolean switch, false unless explicitly present. Library callers use the fourth constructor argument `new Transport(engine,deps,budget,{human:true})`; false/absent cannot acknowledge policy and nonboolean inputs are rejected. This is operator acknowledgement, NOT impersonating a human or a named search bot. It can override only a verified robots Disallow for the HTTPS `online.encodeplus.com/regs/traviscounty-tx/` tenant. It does not bypass corrupt policy, unknown-wire/unfinished stops, challenges, login/paywall, TLS, server cooldowns, budgets or complete-body pacing. Municode remains outside the supported live authorities, with its separately observed challenge unresolved.

Each acknowledged attempt records the exact URL, retained robots SHA256 and matched rule in its versioned operation receipt, separately from unmodified publisher HTTP headers/status. Offline verification accepts those earlier receipts as historical evidence, never as fresh permission: a later unflagged request still rejects the retained Disallow. Existing blocked state/history is neither deleted nor reset.

A bounded native selector/catalog command is available, requiring a literal href evidenced by a retained official County Code root and a separately explicit secure endpoint:

    bun run src/cli.ts archive --root "$ARCHIVE_DIRECTORY" --source-href http://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx --page https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx --allow-network --human --max-requests 2 --max-bytes 4194304 --max-pdf-bytes 1048576

Without `--archive-value`, it returns actual available selector tokens/labels. An explicit published value follows only the source-returned read-only form POST, with fresh own same-origin anonymous session state and subsequent server-selected readback; all selected aliases are retained, not equated to a single chapter identifier. No cookies are borrowed from the operator. Original HTTP href and chosen HTTPS endpoint stay separate. The UUID `doclibrary.aspx?id=...` historical PDF parser recognizes arbitrary actual UUIDs/labels, not only a sample year/chapter.

This is NOT yet a historical original-acquisition path: reader/Title2 navigation, original PDF persistence and unresolved physical-versus-publisher numbering receipts remain unimplemented. Actual amended live acceptance reached HTTP200/158 archive options through this shipped CLI, then a separately bounded selection operation was killed at its outer deadline while its form POST had no recorded headers/body. Its full unknown-wire reservation, unfinished gate and writer lock remain intact; no retry, gate reset, new transport archive or further provider request followed. Do not classify that uncertain outcome as a source outage or claim a historical PDF was acquired. The previously human-acquired original remains distinct evidence, including publisher Ch464/1995 versus physical Ch64/1982 and handwritten1995 facts; this collector does not silently reconcile or certify them.

## Source adapters and date semantics

- `budgets`: enclosing full fiscal-year headings and actual category/volume/language labels; official PDFs outside planning-budget directories are eligible. Fiscal and tax years are separate nullable fields; the small actual sample identifies FY2027/tax2026 and discusses a proposed budget. Preserve conflicting PDF title/body/page labels and original filename revision tokens. No financial interpretation.
- `county-code`: sparse source-linked chapters with title/subtitle context, never generated numbers. A genuinely source-linked official Title 30 PDF is a distinct `title-30` role, not Chapter 30. Footer links stay excluded. Relevant linked archive pages may be discovered; raw historical selector values remain catalog evidence until an actual supported URL/body is advertised. In the current observed root, Code/Archives hrefs use HTTP encodeplus and Title 30 uses external Municode. The HTTPS-only collector retains these blocked hrefs; it neither silently upgrades HTTP nor follows unapproved authorities. Dynamic Code archive bodies and that external Title 30 surface remain unsupported, not claimed complete. The online code is reference-only, not the Clerk's official paper record or legal advice. Body "Amendments added through" and "Chapter ... was amended" dates are separate scoped fields, not blanket effective/publication dates.
- `meeting-archives`: links inside closed static accordions retain original year/month/anchor/session evidence. Malformed `1.25.1000` and filename/date disagreements are not repaired. No invented CivicClerk IDs or claim about archive/boundary completeness. The actual 2010 sample's title says January 5 while its opening sentence says January 2; original bundled bodies and conflict remain intact.
- `election-documents`: same-page election sections and actual direct PDFs. Administering county is not inferred to be every contest jurisdiction. Role, official/unofficial/unknown state, election date, report/attestation date and unknown publication date remain distinct. No Clarity extraction, voter data, inferred certification or discrepancy allegations.

PDFs require expected MIME, magic, byte bounds, Poppler parsing and scoped body identity: a leading chapter title, a minutes meeting title with the exact full date plus Commissioners Court/session text, or the leading explicit fiscal-year identity (not an incidental tax/comparison year). The minutes title controls the selected meeting date; conflicting opening prose remains unmodified evidence, not a repaired date. Budget role and readable election role/date/state must also agree with the selected source evidence. New validation receipts use schema 4 and `identityPolicy: scoped-title-v1`; verification re-evaluates strict identity for older text receipts too, without rewriting them. Text extraction examines only the first three pages and is an identity aid, not structured financial/election interpretation. Unrecognized/ambiguous titles require private review rather than successful automatic import. Body metadata parsing is narrowly scoped to explicit fiscal/tax/amendment/report phrases; unparsed dates remain null. PDF creation/modification and HTTP metadata are retained separately, not promoted to publication dates.

## Explicit selected-page rendered identity review

Empty/corrupt text is not silent success. A trusted reviewer must actually inspect identity-bearing physical pages and submit an explicit private assertion. This is not OCR, financial/election interpretation, or unattended acceptance. Automatic scoped text validators are unchanged; manual review is a separately labeled trust path for all four adapters.

First obtain the exact selection hash and original evidence:

    bun run src/cli.ts review-context --root "$ARCHIVE_DIRECTORY" --observation "$OBSERVATION_ID"

Render each selected physical page separately with a new private prefix (example page 2):

    pdftoppm -f 2 -l 2 -singlefile -scale-to 1400 -png "$RETAINED_PDF" "$PRIVATE_RENDER_PREFIX"

New review JSON fields:

- `schema`: 1; `documentSha256`: full original PDF hash; `selectionSha256`: exact value from review-context; `county`: Travis.
- `pages`: nonempty array of `{page, imageSha256, note}` entries. Page numbers are unique one-based physical pages within the parsed PDF. Notes record actual visual identity evidence on that page, not inferred meaning.
- `note`: nonempty overall identity assertion; `originalAttestationDate` and `attestationDate`: explicit nullable fields (ISO calendar date for the latter when known).

The selection hash binds source, exact URL, chapter, year, full date/original date, role, official/unofficial/unknown state, fiscal/tax year and session. It does not make unknown facts official or establish legal currency. Select the pages needed to evidence the assertion; unreviewed pages remain unreviewed, not implicitly interpreted. The receipt records total PDF pages and precisely which pages were reviewed, with image hashes. Do not submit invented assertions for unread pages.

`$PRIVATE_IMAGE_PATHS_JSON` is an operator-input JSON array of private PNG paths in the same order as review.pages. It is not archive/queue persistence. Each image is at most 5 MiB; the aggregate PDF/image budget is enforced before acceptance.

    bun run src/cli.ts review-pdf --root "$ARCHIVE_DIRECTORY" --observation "$OBSERVATION_ID" --input "$RETAINED_PDF" --images "$PRIVATE_IMAGE_PATHS_JSON" --review "$PRIVATE_REVIEW_JSON" --headers "$RETAINED_PDF_HEADERS" --max-pdf-bytes 134217728 --max-bytes 268435456

The engine freshly renders every specified page and binds the supplied image to the exact original/page, retaining immutable image artifacts and a `reviewed-pages-visual-identity` receipt. Offline verification repeats selection/document/page/image/body checks and deterministic rendering. No OCR is performed.

Legacy `--image PNG` plus the original one-page review JSON remains supported for one-page election documents, and schema2/3/4 one-page receipts remain verifiable without rewriting them. Legacy fields are `documentSha256`, `imageSha256`, `county`, exact discovered `date`, `role`, `state`, nullable `originalAttestationDate`/`attestationDate` and nonempty `note`. The retained reconciliation sample separates original `6.21.22` from reviewer-confirmed `2022-06-21`; those historical facts are not reinterpreted here.

## Integrity, completeness and fail-closed recovery

SQLite stores sources, observations, immutable snapshots, versions/history, per-history validation receipts, runs, attempts, cooldowns, imported headers, wire representations and artifact checkpoints. Hash-named artifacts are promoted with same-filesystem hard links, never overwrite. A checkpoint records expected hash/size and owned partial name before output; database completion follows required artifact promotion. A failed group does not acquire a false completed-selection result: `verify` rejects any selected missing/failed document or incomplete snapshot.

Zero-HTTP verify checks required schema/version markers, SQLite integrity/FKs, every promoted checkpoint AND each required artifact's exact promoted path/hash/size (PDF, snapshot, wire/decoded body, candidate and rendered image), exact reparsed source inventories and snapshot counts/headers, bidirectional observation/version/history identity, validation-receipt hashes/schema/selection, PDF bytes/parser results, and rendered evidence where applicable. Transport attempts and representations/resolutions are checked in both directions, including known wire accounting, original legacy classifier failure identity and full unknown-wire reservations; unknown failed/inflight bodies require a stop gate. Budget checks refuse damaged accounting before another request. Missing files, removed observations, orphan versions or coordinated metadata/receipt drift fail. Legacy normalization and validation receipts are retained/versioned rather than silently rewritten.

Fresh archives initialize archive schema 3 once, including all three transport tables, even for offline-only imports. The required cooldown contract includes `id`, `not_before` and `blocked`, with exactly one row at id 1. Its persisted timestamp must be a nonnegative safe integer (therefore finite); `blocked` is either null or a nonempty, non-whitespace string. Opening, offline verification and transport gates validate this same state before requests or budget changes. Missing columns, ambiguous text/numeric values, invalid stop reasons or missing/extra rows fail closed without resetting, coercing or repairing the durable wait. Distinct transport instances share the completion-to-next-start wait, including time spent consuming the entire body. Existing archives must already contain the full schema; neither opening nor constructing transport recreates missing established tables. Schema 2 and earlier archives require a separately evidenced, manual migration on a private backup. There is no automatic migration/repair CLI. Recover missing transport state from prior durable evidence or refuse continuation; a version-marker update alone is not a migration.

The generic cooldown integrity check also rejects a well-typed deadline below independently retained successful completion, robots-policy/observation or server-header obligations. It runs on reopen, preflight (including local cache/offline operations), and pacing/reservation gates, including after awaited sleep. Common preflight revalidates after its final awaited representation read; shared run/artifact/commit mutation points synchronously recheck cooldown integrity after further awaits, including failure bookkeeping, so an intervening gate fault is rejected without adding local writes. It never silently advances a damaged deadline, shortens a longer hold, clears a manual stop, releases an unknown reservation or rewrites original evidence. Existing unversioned attempts retain their historical 2000ms minimum; operation-versioned attempts require 3000ms, with stricter robots delays in both cases.

New transport run IDs use `transport-work-v2:` while preserving the existing `transport-work-v1:` operation/limits JSON format in the run-kind field. A new `headerTiming` receipt labels the header observation `{clockBasis:"unix-ms",observed:...}`; it is required for successful v2 completions and checked within the attempt's start/completion interval. Reopen and ledger verification share the same nonmutating reservation identity helper: supported run-ID version, operation receipt prefix/kind, full cap, operation identity and finite limits are checked before using header timing or selecting legacy fallback. Unsupported versions or contradictory receipts therefore refuse open and CLI status as well as preflight, without rewriting genuine old UUID/v1 receipts. The unchanged server parser is replayed at that retained receipt time, never reinterpreting an absolute epoch reset as a relative duration when a body crosses the reset. Historical receipts are not retrofitted with invented header times: completion is an explicitly conservative upper bound when replaying their relative server holds. An old gate insufficient for that bound refuses operator-reviewably, even if exact former header time is unavailable; this is not automatic migration permission. Old receipts without such conflicting timing, legacy classifier-resolution evidence and genuinely unknown stopped attempts retain their existing accounting. No schema change, new transport, public acquisition or enCodePlus feature change is part of this generic repair; independent review remains required.

Genuinely pre-checkpoint artifacts require individually reviewed rows in `legacy_artifacts(path,sha,bytes,evidence)`, never a blanket missing-checkpoint waiver. The JSON evidence records `kind: pre-checkpoint-artifact`, exact `path`, `sha`, `bytes`, a `priorArchiveSha256` and a nonempty `reason` identifying the independently preserved prior provenance. Keep that prior archive/evidence private and available for review. These are trusted operator migration assertions, not cryptographic proof of historical truth. Do not create exemptions for lost modern checkpoints, reconstruct checkpoints from arbitrary current finals, or run a generic enumerate-and-bless migration. An existing invalid checkpoint cannot be overridden by an exemption. Verification and artifact reuse never create receipts. The bounded historical sample required 12 individually evidenced pre-checkpoint exemptions on a copied archive; the original archive remains unmigrated and intentionally refuses this version until chief-approved migration.

The shared `.civicclerk.lock` protects the whole archive. Existing locks stop another writer. After interruption, do not automatically remove locks, erase attempts, reset reservations, overwrite finals or append partials. First confirm the recorded writer is stopped and preserve a private archive backup. An unfinished artifact checkpoint makes reopening fail closed; use its ORIGINAL expected hash/size/partial name for manual forensic reconciliation. Do not rehash arbitrary finals to invent a new checkpoint or promote only part of the required evidence. Unknown wire outcomes likewise require explicit operator review; no automatic recovery/reset command is provided. This is honest manual recovery, not byte-range resume or an automated crash-repair guarantee.

## Original bounded exercise (historical, not a fresh acquisition claim)

The bounded implementation exercise used 6 total source attempts including the initial failed classifier receipt: county robots, one current budget page/PDF, VoteTravis robots and one election page/PDF. No further public requests were needed for County Code/minutes retained-original validation. One small PDF per live source, no large adopted budget download.

| Sample | Bytes | SHA-256 |
| --- | ---: | --- |
| FY2027 taxpayer-impact statement | 127112 | `566b43f130ab8395088d566edd6df788a99322a3c385c758b536d4ed4321f5a3` |
| June 11, 2022 official reconciliation (image-only) | 24807 | `d694dfc8a549dd42c8cbade09a8046d5fc19f3929c53cb1b4686171cb7df2156` |
| Current reference Chapter 2, retained | 247899 | `12e09fbf334455d038aade4cba3a7a6e9ff54b790aef1f8953067d6ceddbc806` |
| Current reference Chapter 464, retained | 411612 | `bb112d2ca93a32a96c05185bbcf585596067ce59722b12f0ed621ed1953bac6a` |
| January 5, 2010 minutes, retained | 119994 | `3cdb0b3a0f7e11e90ac493dc56c913516c1c3e4c38077c4d5ce6918a873c4269` |

Retained inventories reproduced 80 occurrences/80 unique current chapter URLs and 988 occurrences/987 unique historical minutes URLs. These are observed link inventories, not all-documents availability or archive completeness. All five selected originals passed offline verification; duplicate imports and local changed-byte fixtures retained correct versions.

Tests exercise compression/length/decompression bounds, exact-source and schema/receipt corruption, aggregate link limits, saved headers, symlinks, writer collision, interruption/reservation/restart and fail-closed checkpoint states. Tests/coverage run with outbound network denied except explicit loopback compression fixtures. The original bounded exercise had 71 passing tests; it is not the current repair’s acceptance claim.

## Source-wide repair: exercised scope and residuals

The repair suite has 82 passing tests and typecheck passes. Four discoveries and three PDFs coexist in one fixture archive across explicit operations; request exhaustion, retained cooldowns, exact reservation receipts and failure gates are tested separately. A fully authored PDF with a real uncompressed RGB image exceeds 5 MiB and passes CLI import, chunked transport collection, immutable persistence and offline verification. This is synthetic scale evidence, not fabricated source acquisition. The formerly retained approximately 29 MB adopted-budget original was not found in the permitted retained inventory and was not downloaded again; that real-volume replay remains unverified.

The bounded public metadata exercise used 12 serial attempts: three robots, six source-reference pages and three actual linked nested budget pages. All returned HTTP 200, with 1,110,057 total encoded wire bytes and a measured minimum 3,001 ms completion-to-next-start gap. No PDFs, retries, redirects, auth or challenge workarounds were used. These are metadata availability observations, not whole-archive document availability or completeness.

- The current budget page yielded seven PDF occurrences. Historical nested pages actually advertised by the archive, `fy11-content` and `fy03-content`, yielded 37/34 and 32/30 occurrences/unique URLs; `budget-development` yielded no eligible direct PDFs. These URLs are observations, not hardcoded year restrictions.
- Current Code yielded 80 chapter URLs. Its HTTP encodeplus archive and external Municode Title 30 links remain explicit policy/authority blockers, not successfully acquired history. Retained UI selectors are catalog evidence only. The collector never invents historical download routes from option values.
- Historical minutes yielded 988 occurrences/987 URLs; election publications yielded 207 occurrences. Any source years/dates/roles actually discovered remain selectable; malformed or conflicting dates stay unresolved.
- Three retained originals were imported and verified in the same metadata archive with zero additional HTTP: Chapters 2 and 464 and January 5, 2010 minutes. Original hashes were unchanged. The title/opening-prose January 5/January 2 conflict was preserved.

Archive schema remains 3: no automatic migration, historical-row rewriting or policy reset is required for this repair. New snapshots use adapter parser schema 3; schemas 1/2 retain the prior direct-page inventory semantics when reverified. New selected-page visual review uses a separately labeled schema4 validation quality; legacy one-page receipts retain their existing validation path.

Quality gates were run on an external private source mirror preserving sibling imports. CRAP was measured from fresh Bun LCOV for all 148 own functions: maximum 9, strictly below 10. Dryer found no candidates at similarity 0.8. Scoped budget mutation testing executed 32 sites: 30 killed, two surviving boundary cases; it is not a whole-program mutation score. Unchanged-worker tests passed and a known disabled-request-limit defect failed after a conflated request/byte-bound test was separated. Remaining survivors concern one-byte PDF reservation and a later metadata-reservation arithmetic boundary, not evidence of complete branch coverage. Independent review and acceptance remain outstanding.
