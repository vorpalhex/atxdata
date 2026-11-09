# VoteTravis election publications

Implementation update (bounded implementation; independent review pending): `programs/county-documents-consume/` provides one Bun/SQLite acquisition engine with four explicit adapters, bounded discovery/collect/sync, status and zero-HTTP verification. See its README for setup, exact limits, source scope, private headers/originals and fail-closed manual recovery. The earlier manual procedure/evidence below remains historical; it is not a claim of complete archive availability.

Actual bounded collector proof: VoteTravis robots, the canonical same-page discovery and one June11,2022 reconciliation original acquired,24807 bytes,SHA256 `d694dfc8a549dd42c8cbade09a8046d5fc19f3929c53cb1b4686171cb7df2156`. Its extracted text is empty/image-only, not absent source data. The actual one-page render was visually inspected: Travis,2022LocalRunoff,06/11/2022,OfficialTotals,attestation original6.21.22 (review-confirmed2022-06-21). Explicit offline review binds exact original/image hashes and selection, and zero-HTTP verify rerenders/checks the receipt. Administering county is not a contest-jurisdiction assertion; contest jurisdictions/publication date stay unknown. No totals/certification/Clarity interpretation. Independent review/card acceptance remain pending.

Intent: LLM-assisted, agent-operated access procedure for a bounded election/document selection, not a new client or unattended crawler. Results publications, reconciliation and audit/certification forms are distinct from structured Clarity extraction. No voter-level records are in scope.

## Scope and discovery

Start at https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms/ . On 2026-11-04 the URL without its trailing slash returned 301 to this exact HTTPS URL; redirects require a separate inspected, paced request, not `--location`.

The saved page contains current reconciliation links and historical election sections on the SAME page. Its November 2022–present results anchors point to https://results.enr.clarityelections.com/TX/Travis/ . That linked landing was fetched (HTTP 200, “List Elections” application shell); no vendor API, election IDs, data exports or structured extraction were exercised here. Historical direct PDFs occur under `wp-content/uploads/travis-tx/election-results/`, while newer forms also occur directly under `wp-content/uploads/`. Follow actual anchors; do not generate filenames from dates or assume a separate archive endpoint.

Parse saved HTML with an HTML parser, resolve relative anchors against the page URL, and retain exact labels AND enclosing year/election/jurisdiction headings. Deduplicate resolved URLs without losing label occurrences. The selected “Saturday, June, 11, 2022 Local Runoff Election” section under “2022 Travis County Official Results” had three anchors / three unique URLs: Cumulative, Election Reconciliation – Official Totals, and Precinct by Precinct. Only the first two were acquired. This selected section has no pagination; no complete archive enumeration, earliest-year boundary or remote holdings count is claimed.

The current page also links explicitly unofficial preliminary forms. Preserve that state even if a filename contains “Final”. Official reconciliation is not itself a certification of every contest or proof that a later revision does not exist.

## Prerequisites and private state

Use `terminal`, `read_file`, `write_file`, a POSIX shell, curl, Python 3, Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`), `shasum` and an image viewer. No account, cookie replay, identity disclosure, Bun or SQLite service is needed. Existing CivicClerk serial HTTP/SQLite and Legistar atomic-download/test conventions were inspected; their CLI endpoints are not election collectors.

Obtain an approved private archive outside the checkout. Keep original pages/PDFs, headers (possibly cookies), renders, extracted text, scans and notes there. Use fresh observation directories and trusted non-symlink paths, never server-derived filenames. In the shell examples, set `ARCHIVE_DIRECTORY` and `RUN_DIRECTORY` to approved absolute directories; these are non-resolving configuration placeholders, not repository paths. All shell blocks must run as one command so failure propagates.

Before source requests, set `LOCK_OWNER` to a unique nonempty session/run identifier, explicitly `cd` to the archive and acquire a lock:

```sh
cd "${ARCHIVE_DIRECTORY:?}" && mkdir .election-documents-lock &&
printf '%s\n' "${LOCK_OWNER:?}" > .election-documents-lock/owner
```

An existing lock stops work. Record the owning session/run in it; hold the lock across discovery, transfers and inventory updates. Do not remove another writer's lock. After a crash require operator confirmation that no writer remains before clearing it. Use a fresh private observation, record approved bounds (initially discovery plus at most two PDFs for ONE named election), attempt counts and archive-wide not-before UTC time. Every subsequent command must explicitly `cd` successfully and verify the owned lock; the lock existence check below is necessary but does not replace checking ownership.

Before each transfer record a private inventory row: discovery URL/snapshot, exact anchor and source URL, observation UTC, election date and exact type labels, administering county and contest jurisdictions, document role, official/unofficial/unknown status with supporting page/body evidence, filename revision label, explicit report/attestation dates, publication/revision date if stated (otherwise unknown), HTTP Last-Modified/ETag, PDF metadata separately, attempts/outcomes/cooldown, local filename, bytes, SHA-256 and pending/failed/downloaded/verified-existing status. This is a manual ledger, not client persistence. Retain conflicting labels and all prior observations; URL identity alone is not version identity.

## Serial request and cooldown gate

One in-flight request through full body completion. Leave at least two seconds after every attempt. Before EVERY next request inspect the preceding headers, including HTTP 200, for `Retry-After`, exhausted `RateLimit-Remaining`/`RateLimit-Reset`, `X-RateLimit-*`, structured `RateLimit` policies (`r=0;t=...`) and any published quota. Honor the longest instruction without a cap. Account for server Date when interpreting HTTP-date Retry-After; standard reset is a delay, legacy X reset can be epoch-based. Stop on ambiguous instructions. Persist not-before UTC archive-wide and honor it across restarts. Two-second sleeps alone do NOT implement server cooldowns.

Retry only transport/timeouts, HTTP 408/429 and 5xx, at most three additional attempts per URL/observation, including across restarts. Wait max(server instruction, two seconds, exponential backoff 2/4/8 seconds) plus fresh 0–1 second jitter calculated with Python, not mental arithmetic. Log each outcome and retain failure evidence. Permanent 4xx, authentication, challenge HTML, invalid PDF, size/time bounds or exhausted retries stop the file; no challenge bypass, registration, purchase or records request. No automatic retries, redirects, HEAD probes, ranges or parallel discovery. No numeric quota/cooldown header was observed in this sample, not permission to accelerate.

Set `URL` to one exact discovered HTTPS link and `NAME` to a chosen simple prefix such as `cumulative`. Reuse this request shape for HTML discovery with a different prefix; inspect substantive links before promoting HTML. Use a fresh prefix for every attempt, preserving headers and outcomes. Curl's FIRST argument must be `--disable` to ignore curlrc settings. After checking prior cooldown/lock ownership and recording the attempt:

```sh
cd "${RUN_DIRECTORY:?}" &&
test "$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().strip())' "${ARCHIVE_DIRECTORY:?}/.election-documents-lock/owner")" = "${LOCK_OWNER:?}" &&
case "${NAME:?}" in *[!a-z0-9-]*|'') exit 1;; esac &&
test ! -e "$NAME.part" && test ! -L "$NAME.part" &&
test ! -e "$NAME.headers" && test ! -L "$NAME.headers" &&
test ! -e "$NAME.request" && test ! -L "$NAME.request" &&
test ! -e "$NAME.transport-ok" && test ! -L "$NAME.transport-ok" &&
sleep 2 &&
curl --disable --silent --show-error --proto '=https' --connect-timeout 20 --max-time 120 --max-filesize 10000000 --user-agent 'atxdata-election-documents/0.1' --dump-header "$NAME.headers" --output "$NAME.part" --write-out '%{http_code}\n%{size_download}\n%{url_effective}\n' "${URL:?}" > "$NAME.request" &&
printf 'curl completed\n' > "$NAME.transport-ok"
```

A transport marker is NOT semantic success. Inspect headers before continuing, then require HTTP 200, expected HTTPS effective URL, correct MIME type, actual byte count matching transfer size and Content-Length when present, `%PDF-` signature and successful parsing. Do not promote redirects/challenges as documents. For a PDF the following guarded checks fail nonzero rather than just printing a signature:

```sh
cd "${RUN_DIRECTORY:?}" &&
test "$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().strip())' "${ARCHIVE_DIRECTORY:?}/.election-documents-lock/owner")" = "${LOCK_OWNER:?}" &&
case "${NAME:?}" in *[!a-z0-9-]*|'') exit 1;; esac &&
test ! -e "$NAME.pdfinfo" && test ! -L "$NAME.pdfinfo" &&
test ! -e "$NAME.txt" && test ! -L "$NAME.txt" &&
test -f "$NAME.transport-ok" &&
test "$(python3 -c 'import sys; print(open(sys.argv[1]).readline().strip())' "$NAME.request")" = 200 &&
python3 -c 'import pathlib,sys; p=pathlib.Path(sys.argv[1]); b=p.read_bytes(); assert b.startswith(b"%PDF-"), "not PDF"' "$NAME.part" &&
pdfinfo "$NAME.part" > "$NAME.pdfinfo" &&
pdftotext -layout "$NAME.part" "$NAME.txt" &&
shasum -a 256 "$NAME.part"
```

The MIME/effective-URL/size comparisons and semantic identification are mandatory manual gates in addition to these commands. Inspect body date/type/jurisdiction/status, first and last pages and attestation. If text is empty or corrupted, render ALL pages of these small files with `pdftoppm -scale-to 1400 -png "$NAME.part" "$NAME-page"` and inspect the images. A successful pdftotext exit is not proof of readable text. Retain validation outputs privately. Only after all gates pass, set `EXPECTED_SHA256` to the validated partial's hash and promote in the same directory/filesystem:

```sh
cd "${RUN_DIRECTORY:?}" &&
test "$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().strip())' "${ARCHIVE_DIRECTORY:?}/.election-documents-lock/owner")" = "${LOCK_OWNER:?}" &&
test ! -e "$NAME.pdf" && test ! -L "$NAME.pdf" &&
printf '%s  %s\n' "${EXPECTED_SHA256:?}" "$NAME.part" | shasum -a 256 -c - &&
mv -n "$NAME.part" "$NAME.pdf" && test ! -e "$NAME.part" &&
printf '%s  %s\n' "$EXPECTED_SHA256" "$NAME.pdf" | shasum -a 256 -c -
```

`mv -n` may exit zero when refusing an overwrite; pre/postchecks are required. Mark downloaded only after the final checksum agrees. Save a private standard-format `checksums.sha256` plus provenance ledger. On local rerun, `cd "${RUN_DIRECTORY:?}" && shasum -a 256 -c checksums.sha256`; skip HTTP only when ledger identity/status AND hashes agree. Missing/corrupt files fail the skip gate; preserve failed bytes privately before restarting a bounded full transfer. Quarantine orphan partials only after confirming no writer; never append or treat them as completed. Keep attempt/cooldown state. A remote revision check requires a NEW observation and fresh bounded page/PDF fetches; local skipping does not detect remote change. Release the owned lock only after safely saving state.

## Actual verification and limitations

2026-11-04 UTC: one inspected 301, the canonical official HTML page, two PDFs and the officially linked Clarity landing, serial anonymous full transfers. Four final responses HTTP 200; no retry/cooldown or quota headers observed. No cookies replayed. Exact selected PDF URLs (preserve the source's spelling/encoding):

- Cumulative: https://votetravis.gov/wp-content/uploads/travis-tx/election-results/2022/Saturday,%20June,%2011,%202022%20Local%20Runoff%20Election/LR22OfficialCumulativeResults.pdf
- Reconciliation: https://votetravis.gov/wp-content/uploads/travis-tx/election-results/2022/Saturday,%20June,%2011,%202022%20Local%20Runoff%20Election/LR22ReconcilliationFinal.pdf

| Role | Bytes | Pages | SHA-256 |
| --- | ---: | ---: | --- |
| Official cumulative results | 101616 | 2 | `c9ffb2a708a8952add464b9b79c28184a078972f822628fa23e499b9c729f528` |
| Election Reconciliation – Official Totals | 24807 | 1 | `d694dfc8a549dd42c8cbade09a8046d5fc19f3929c53cb1b4686171cb7df2156` |

Both parsed with Poppler and all three pages were rendered/visually inspected. The cumulative text extraction is corrupted; do NOT use it as structured results. Its rendered title is “Travis County Joint General and Special Runoff Elections”, June 11, 2022, “OFFICIAL RESULTS”; report footer “Election Summary - 06/21/2022 11:39 AM” (timezone unstated). Contests: City of Leander Councilmember Places 3 and 5 and City of Manor Council Place 6 Unexpired Term. Preserve these jurisdiction labels, not an assumption of countywide or full cross-county city totals. Reconciliation says “2022 Local Runoff”, 06/11/2022, Travis, “Official Totals”, attestation dated 6.21.22. Both show 828 counted/cast ballots. This spot-check is not contest-total validation or certification of the entire election.

HTTP Last-Modified is 2023-06-08 for both; PDF creation/modification metadata is 2023-05-24. Neither is the 2022 body report/attestation date or a verified publication date. Publication/revision dates remain unknown; preserve separate metadata and body hashes. No audit/certification PDF for this election was acquired or inferred absent.

A separate-process checksum rerun returned both files OK with zero source requests. Seventeen private offline checks exercised the documented shell blocks: second-writer/wrong-owner/wrong-cwd/unsafe-name refusal, transport failure propagation with `--disable` first, HTTP 301/HTML/truncated-PDF rejection, valid-PDF parsing, wrong-hash refusal, no-clobber promotion including a dangling symlink, and missing/corrupt checksum failures. An orphan partial was removed without changing verified originals. These are manual-procedure safety checks, not an unattended client's test suite; offline curl stubs supplied no acquisition evidence. Supported: bounded manual discovery, two direct publications, provenance/integrity and file-level restart. Unverified: other elections/forms, complete archive/history, later revisions, precinct PDF, Clarity extraction, byte-range resume and unattended scheduling. No production code: TDD, TypeScript typecheck, CRAP/coverage, dryer at 0.8, mutation testing and SQLite integrity are N/A, not passing gates. Independent review is chief-owned and separate from implementation checks.
