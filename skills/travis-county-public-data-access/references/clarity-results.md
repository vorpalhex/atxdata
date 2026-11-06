# Clarity structured election results

Intent: LLM-assisted, supervised access skill for catalog discovery and ONE small election snapshot, not a client, backfill or certification service. No voter-level records, registrations, forms, accounts or challenge bypass. Keep all original data, HTTP headers, local state, validation output and scans in approved private storage outside source.

## Prerequisites and bounds

Use a POSIX shell, curl, Python 3 standard library, `shasum`, Poppler and an image viewer. Bun/SQLite are not required for this manual procedure. Existing CivicClerk serial HTTP/SQLite tests and Legistar full-body download conventions were inspected; neither client is a Clarity collector. Do not turn these examples into an unattended client hidden in Markdown. If automation is needed later, use Bun/TypeScript and SQLite runs/history/session/download state.

Before work, obtain an approved private archive and fresh observation directory; use trusted non-symlink directories. Set `ARCHIVE_DIRECTORY`, `RUN_DIRECTORY` and a unique nonempty `LOCK_OWNER` explicitly (non-resolving configuration placeholders, not repository paths). Initial bound: official page, catalog/frontend discovery, one selected election, one XML export plus the small JSON files needed to verify it, and at most one official audit PDF. Stop before transferring a body larger than 12 MB; maximum uncompressed XML 100 KB for the tested small election. Different scopes require a new decision.

```sh
cd "${ARCHIVE_DIRECTORY:?}" &&
mkdir .clarity-lock &&
printf '%s\n' "${LOCK_OWNER:?}" > .clarity-lock/owner
```

An existing lock stops work. Hold it across all source requests and inventory updates; never delete another owner's lock. After a crash, confirm no active writer before clearing stale locks or quarantining partials. Every subsequent command must successfully enter the chosen run directory and verify lock ownership. Use local simple names, not server filenames. Save a private append-only action/reason and provenance ledger, not a JSON client manifest: URLs and exact source labels, election/state/county IDs, version, language, body/report timestamp, website-update timestamp, observation UTC, final/official/unofficial assertions with their exact evidence, conflicting flags, per-attempt outcome, cooldown/not-before UTC, HTTP Date/Last-Modified/ETag, MIME, bytes and SHA-256. Missing city identifiers/publication dates stay unknown.

## Serial safe boundary

Only one source transfer in flight, through the complete body; at least three seconds after each attempt. Before EVERY request, inspect the previous response (including 200) and published policies. Honor the longest `Retry-After` seconds/date, exhausted standard `RateLimit-Remaining`/`RateLimit-Reset` delay, legacy `X-RateLimit-*` epoch reset, structured `RateLimit` `r=0;t=...`, and published quota. Use server Date for date cooldowns, persist archive-wide not-before UTC, and honor it after restart. Ambiguous instructions stop work. A fixed sleep alone is not the cooldown gate. No numeric quota/cooldown instruction was observed in the sample.

Use at most three extra attempts for transport/timeouts, HTTP 408/429/5xx, with max(server wait, three seconds, exponential 2/4/8 seconds) plus Python-calculated fresh 0–1 second jitter. Record attempt budgets across restart. Permanent 4xx, challenges/authentication, malformed content, size/time ceiling or exhausted budget stop that acquisition. No redirects, retries, ranges or parallel requests hidden inside curl. Inspect a redirect target and perform a separate paced request only if authorized. The election's documented `versions.txt` 404 fallback below is not a retry or endpoint guess.

After the manual cooldown/attempt gate, set `NAME` and exact inspected HTTPS `URL`; execute this entire block as one command. Curl's FIRST argument is `--disable`, ignoring curlrc defaults.

```sh
cd "${RUN_DIRECTORY:?}" &&
test "$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().strip())' "${ARCHIVE_DIRECTORY:?}/.clarity-lock/owner")" = "${LOCK_OWNER:?}" &&
case "${NAME:?}" in *[!a-z0-9-]*|'') exit 1;; esac &&
for suffix in part headers request transport-ok; do
  test ! -e "$NAME.$suffix" && test ! -L "$NAME.$suffix" || exit 1
done &&
sleep 3 &&
curl --disable --silent --show-error --proto '=https' --connect-timeout 20 --max-time 120 --max-filesize 12000000 --user-agent 'atxdata-clarity-discovery/0.1' --dump-header "$NAME.headers" --output "$NAME.part" --write-out '%{http_code}\n%{size_download}\n%{url_effective}\n' "${URL:?}" > "$NAME.request" &&
printf 'curl completed\n' > "$NAME.transport-ok"
```

Fresh name per attempt; retain failed headers/body/status privately. The transport marker is NOT semantic success. Require HTTP 200, exact expected effective URL, expected MIME, complete transfer and agreement of actual bytes/transfer bytes/Content-Length when present. Reject challenge HTML. A 200 catalog shell is not results. The catalog was served with gzip Content-Encoding despite no compression request: preserve original transfer bytes/hash and decode gzip offline before JSON parsing; distinguish encoded bytes from decoded bytes. Do not hash one and report the other.

## Discover actual routes, not another county's template

Start at https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms/ and follow its actual Clarity anchor to https://results.enr.clarityelections.com/TX/Travis/ . Save the official link evidence. Parse HTML using an HTML parser and resolve actual script URLs. On 2026-11-04:

1. Catalog shell's `main.7039b550b07d01cd.js` explicitly loaded relative `elections.json?v=timestamp`; a bounded fetch of `elections.json` returned 17 unique EIDs, StateId `9`, CountyId `1239`. No pagination/total field was exposed; this is the complete fetched array, NOT proof of exhaustive historical holdings. Dates span November 2022–November 2026.
2. That bundle's `getUrl` constructs state/county/EID links. Select EID `125662`, “2025 December Joint General and Special Runoff Elections”, December 13, 2025. Fetch `/TX/Travis/125662/` on the same origin.
3. Its actual redirect JavaScript requests relative `versions.txt`; HTTP 404 was observed. The script explicitly falls back to `web.345435/`. Fetch that fallback, not a guessed version.
4. That interface's `main.cd289ac4a09a51a3.js` identifies `./web.json`, `current_ver.txt`, `config.json`, language-specific election settings/summary, status/details and report routes. `web.json` confirms TX/Travis/EID, public file host `https://results.enr.clarityelections.com/`, empty API host and `results:true`. The file service, not a speculative API, is the tested route.
5. `/TX/Travis/125662/current_ver.txt` returned numeric version `367565`. Validate a digits-only token before using it in a path. Frontend `getUri` explicitly builds `/TX/Travis/EID/VERSION/json[/LANG]/FILE`; report links use `/TX/Travis/EID/VERSION/reports/FILE`. Config returned `lang:en`, `isPublished:true`, template `345435`.

Verified paths relative to that public host:

- `TX/Travis/125662/367565/json/config.json`
- `TX/Travis/125662/367565/json/en/electionsettings.json`
- `TX/Travis/125662/367565/json/en/summary.json`
- `TX/Travis/125662/367565/json/status.json`
- `TX/Travis/125662/367565/json/details.json`
- `TX/Travis/125662/367565/reports/detailxml.zip`

The bundle also exposes Summary CSV (`summary.zip`), Detail XLS (`detailxlsx.zip`), TXT and without-vote-type exports, but those bodies were NOT fetched. Only download a format enabled by this election's settings (`chkgeneratexml:true` here). Revalidate script/config/version evidence when templates change; do not synthesize filenames from another jurisdiction. The observed settings list 18 version labels, not 18 archived snapshots. Fetch only the selected version; no version backfill.

## Fail-closed export validation and promotion

Before promotion require ZIP MIME/signature, CRC success, exactly the intended member, bounded uncompressed size, no paths/traversal or encryption, valid XML without DTD/entities, expected election name/date/region, stable string contest/choice keys, precinct-label sets, and numeric nonnegative counts. Read ZIP members in memory, never blindly extract. For the tested file this bounded gate is executable:

```sh
cd "${RUN_DIRECTORY:?}" &&
test "$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().strip())' "${ARCHIVE_DIRECTORY:?}/.clarity-lock/owner")" = "${LOCK_OWNER:?}" &&
test -f export.transport-ok &&
test "$(python3 -c 'print(open("export.request").readline().strip())')" = 200 &&
python3 -c 'import pathlib,zipfile,xml.etree.ElementTree as E; p=pathlib.Path("export.part"); assert p.read_bytes().startswith(b"PK\x03\x04"); z=zipfile.ZipFile(p); assert z.namelist()==["detail.xml"]; i=z.getinfo("detail.xml"); assert 0<i.file_size<=100000 and not i.flag_bits&1; assert z.testzip() is None; b=z.read(i); assert b"<!DOCTYPE" not in b and b"<!ENTITY" not in b; x=E.fromstring(b); assert x.tag=="ElectionResult" and x.findtext("ElectionDate")=="12/13/2025" and x.findtext("Region")=="Travis"; assert len(x.findall("Contest"))==2' &&
shasum -a 256 export.part
```

This is a signature/schema precheck, not the full semantic/count gate. Offline, parse ALL contests/choices/vote types/precincts; check duplicates and equal-length parallel arrays before joining. Reconcile every precinct sum to vote-type total, vote types to choice total, choices to summary totals, and detail arrays by exact contest key/precinct label/choice order. Compare turnout sums separately; ballots are not votes. Preserve discrepancies, do not fill missing results with zero or silently repair flags. Audit/publication validation below is essential, not optional. Save raw XML and JSON intact, plus private comparison output.

Once all gates are reviewed, set `EXPECTED_SHA256` from the validated ZIP and atomically promote without overwriting:

```sh
cd "${RUN_DIRECTORY:?}" &&
test "$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().strip())' "${ARCHIVE_DIRECTORY:?}/.clarity-lock/owner")" = "${LOCK_OWNER:?}" &&
test ! -e export.zip && test ! -L export.zip &&
printf '%s  export.part\n' "${EXPECTED_SHA256:?}" | shasum -a 256 -c - &&
mv -n export.part export.zip && test ! -e export.part &&
printf '%s  export.zip\n' "$EXPECTED_SHA256" | shasum -a 256 -c -
```

Same filesystem; `mv -n` alone may report success without moving. Mark verified only after final checksum. Persist a private standard-format checksum file and ledger identity. On a separate-process rerun, verify ALL retained checksums; skip HTTP only if file hash AND ledger identity/status agree. Corrupt/missing files fail closed; preserve failed/orphan partials after confirming no writer, then perform a new bounded FULL transfer with a fresh name. No byte resume. Remote change detection requires a new observation; local skipping says nothing about current server content. Release only the owned lock after state is safely recorded.

## Actual acquisition and comparison limits (2026-11-04 UTC)

One full 2,053-byte ZIP, SHA-256 `7a602e2d2a4be10a0615f3b4cab102d32c7cd0e236610ee0501902a64c715a94`, contains only `detail.xml` (23,890 bytes, SHA-256 `81a61f910b1ba94d5d4a1ba1ffe5d7b4fc4c1fec576f2065e8acf4eb77376d78`). CRC/XML parse succeeded. Two contests, four choices, five vote types per choice, 31 turnout precinct labels and 310 choice/vote-type/precinct rows were acquired. All nested sums reconcile; JSON summary/details totals agree with XML. No pagination inside this one export. This establishes that snapshot, not complete remote election/history coverage.

- XML timestamp `12/19/2025 6:06:46 PM CST`; website update `12/19/2025 6:08:30 PM CST`. Preserve separately from observation and HTTP modification times.
- County jurisdiction is source CountyId `1239`, StateId `9`, TX/Travis. Contest `0004` is City of Leander Councilmember Place 3 Unexpired Term, choices `001`/`002`, totals 656/668; `0005` is City of Pflugerville Mayor, choices `001`/`002`, totals 2587/3298. Keys are strings scoped to county/election/contest; repeated choice keys are NOT global IDs. Precinct `name` labels (including `999`) are source identifiers, not invented permanent geographic IDs. City labels come from contest text; numeric municipal IDs were not supplied/verified. No statewide or full cross-county city totals are claimed.
- Turnout sums: 53,766 registered / 7,212 ballots. Summary candidate votes total 7,209; do not conflate ballots and valid candidate votes or invent an undervote explanation.
- Published header in `pagesettings.web.header` says “Official Results” and “7/7 Vote Centers Reporting”. Yet `chkisfinalupload:false`, `chkiscanvasupload:false`, contest reported counts zero (0/4, 0/27), status S has 27 values `2` and four `1`, all 31 C values `0`. Preserve these conflicting representations. Header claims official; final/certification machine flags do NOT establish a certified/final snapshot. Do not relabel partial/nonreporting precincts as complete from the vote-center header.

Official publication inspection used the VoteTravis-linked [GR25 hand-count audit](https://votetravis.gov/wp-content/uploads/GR25-Summary-and-Certification-of-Post-Election-Hand-Count-Audit.pdf): 1,724,946 bytes, four pages, SHA-256 `8de3624377091b9f4898a56c465aae8393de6e39ff838c7971746758cb950413`. Rendered pages 1, 2 and 4 were independently inspected. The audit reports zero discrepancies between its own selected electronic counts and hand tallies. Page 1 defines a selected audit population including ballots by mail under Section 87.1231; it does not establish equality with every later XML precinct/vote-type population. The audit completed December 17 and was dated December 18, 2025; XML version `367565` is timestamped December 19 and has no matched audit snapshot identity. Population/cutoff/version comparability is therefore unestablished, so no numerical audit/result discrepancy or election-error inference is supported. Keep raw comparison notes private. A selected Leander early-voting aggregate equality is only that equality, not independent contest-wide validation. Polling-location counts cannot be joined as precinct totals. Page 4 heading says December 15 while its footer/election context says December 13; preserve this as a document-label inconsistency, not evidence of an election-result error. No contest-wide certification or fully rendered live-interface verification is claimed.

## Verification limits and quality scope

A separate process verified all 16 initial retained-body checksums with zero HTTP. Seventeen offline checks executed the actual documented shell blocks and checksum gates: lock overlap/wrong-owner/unsafe-prefix refusal, curl failure propagation with `--disable` first, valid ZIP parsing/promotion, non-200/HTML/truncated-ZIP rejection, wrong-hash refusal, dangling partial/destination and existing-destination no-clobber, valid/corrupt/missing reuse checks. Curl stubs supplied no live acquisition evidence. A live 1,000-byte ceiling returned curl 63 with zero body bytes and no promotion; a fresh full transfer matched the original export hash. Before/after version tokens both remained `367565`; this detects a version switch during that observation, not silent server rewrites. Original bytes/headers/comparisons remain private, not fixtures in source. No account/cookie replay or challenge was used. A live transport failure, server cooldown, version race and every historical format remain untested; the conservative manual gates are not a claim of unattended recovery. The `current_ver.txt` value is not an immutable-server guarantee; a new observation must recheck it and flag changes rather than mix versions.

No production code added: TDD, TypeScript typecheck, SQLite integrity, measured CRAP/coverage, dryer 0.8 and mutation scores are N/A, not passes. Manual command validation and data comparison are the applicable gates. Independent review is chief-owned and remains separate. Broader catalog/history, municipal-ID resolution, final/certified-state interpretation and any population/version-comparable audit comparison require further bounded investigation.
