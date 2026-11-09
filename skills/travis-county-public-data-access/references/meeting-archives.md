# Historical Commissioners Court minutes access

Implementation update (bounded implementation; independent review pending): `programs/county-documents-consume/` provides one Bun/SQLite acquisition engine with four explicit adapters, bounded discovery/collect/sync, status and zero-HTTP verification. See its README for setup, exact limits, source scope, private headers/originals and fail-closed manual recovery. The earlier manual procedure/evidence below remains historical; it is not a claim of complete archive availability.

Collector retained-original proof: closed-accordion replay988 occurrences/987 unique URLs, unchanged January5,2010 original and original headers imported. Exact year/month/label tokens, malformed1.25.1000 and source anomalies are preserved without replacement URLs or invented CivicClerk IDs. Duplicate and selected zero-HTTP verification pass; no fresh minutes HTTP. Title/opening-sentence date conflict and bundled bodies remain; noindex/noarchive/nosnippet instructions stay in private receipts. No boundary/history completeness claim. Independent review/card acceptance remain pending.

## Scope and prerequisites

A supervised, bounded access procedure, not an unattended client or backfill. LLM-assisted contribution. Use for one selected historical meeting and at most two small documents; this verification acquired one. Require a POSIX shell, curl, Python 3, Poppler (`pdfinfo`, `pdftotext`, optionally `pdftoppm`) and SHA-256 tooling. No account, cookies, API key or new database is needed. Keep original records, headers (which may contain cookies), extraction/render outputs, provenance and logs in operator-approved private storage outside source.

For scheduled/broad collection, first implement a reviewed SQLite-backed client using existing CivicClerk/Legistar HTTP, streaming and storage conventions. Do not turn these instructions into a hidden bulk client, JSON manifest service or crawler.

## Official discovery and coverage

Start with this exact official page, then inspect its saved HTML, not guessed filenames:

https://countyclerk.traviscountytx.gov/departments/commissioners-court/cc-archives/

On 2026-11-04 it described “Searchable minutes from 1996 to present day.” Its year/month accordions already contained all static links in the acquired HTML, including closed accordions; opening every accordion makes no additional acquisition necessary. There were 988 PDF anchor occurrences / 987 distinct relative URLs containing `/commissioners_court/archives/`, in year directories 1996–2010. This is a scoped link inventory, not a count of meetings, successfully retrievable PDFs or all county holdings. One URL, `archives/2002/01162002vs.pdf`, appeared twice. No next/previous/page-query anchors were found in the saved page. Do not equate absent pagination controls with proof of complete county history.

The “2011 to Present” anchor was actually followed:

https://traviscotx.civicclerk.com/web/home.aspx

It returned HTTP 301 to `https://traviscotx.portal.civicclerk.com`. The redirect target was not fetched in this historical sample; the modern portal/client is separately documented in the main skill. Thus this discovery found two systems: clerk-hosted static historical PDFs and the officially linked CivicClerk service, not an additional historical vendor API. Do not invent a legacy search API or infer a CivicClerk event ID for these PDFs.

Coverage interpretation:

- Advertised split: static 1996–2010; CivicClerk 2011 onward. No advertised year overlap, but cross-system content/identity overlap was not tested.
- Actually acquired here: one January 5, 2010 voting-session minutes PDF, outside the separately verified modern CivicClerk sample. The existing CivicClerk inventory demonstrates a 2021 meeting, not the oldest available event or complete modern coverage.
- Pre-1996 holdings, the 2010/2011 boundary, 2011–2020 availability, missing meetings within listed years, other document roles and remote revisions remain unverified. These are verification gaps, not proof the records do not exist.
- Labels/filenames are fallible: the landing includes a `1.25.1000` label pointing into the 2000 directory and a `2.28.1996` label whose filename is `022895vs.pdf`. Preserve exact tokens; do not silently repair dates or fetch a synthesized replacement.

## Safe manual run

Use `terminal` with its working directory set explicitly to the private observation directory. Below, `APPROVED_MEETING_RUN` means its operator-supplied canonical absolute path, and `MEETING_ARCHIVE_OWNER` a fresh observation token set in the current terminal environment. They are runtime configuration, not paths/tokens to commit. Reject symlinked directories and confirm the directory is private/trusted. Acquire one archive-wide lock before creating observation subdirectories or issuing requests; a lock per new subdirectory alone does not prevent overlapping observations. Store its owner token with `write_file`, and keep a private owner marker in the observation directory. On each block, verify the canonical cwd and that the archive-wide lock and observation marker still belong to this token. Never remove another writer's lock; stale locks require confirming the writer has stopped first.

Maintain a concise private action/reason log. Before a request, record its exact URL, attempt number and status pending; after it, retain curl exit status, HTTP outcome, transfer size, UTC observation time and headers. Retain a not-before UTC timestamp and remaining retry budget across process restarts. No request is authorized merely because a new shell or observation directory was created.

This is the exercised request shape for the selected historical PDF. The shell variables must be set beforehand; `MEETING_ARCHIVE_LOCK` names the already-owned archive-wide lock. Store the exact observation token, without a newline, in its `owner` file and the observation's `owner` marker using `write_file`. Choose simple fixed artifact names, never server-supplied filesystem paths.

```sh
(
  set -euC
  umask 077
  test "$(pwd -P)" = "$APPROVED_MEETING_RUN"
  python3 -c 'import os; from pathlib import Path; token=os.environ["MEETING_ARCHIVE_OWNER"]; lock=Path(os.environ["MEETING_ARCHIVE_LOCK"]); assert not lock.is_symlink() and lock.is_dir(); assert not (lock/"owner").is_symlink() and (lock/"owner").read_text()==token; assert not Path("owner").is_symlink() and Path("owner").read_text()==token'
  for name in meeting-2010-01-05.headers meeting-2010-01-05.pdf.part meeting-2010-01-05.pdf meeting-2010-01-05.outcome; do
    test ! -e "$name" || exit 1
    test ! -L "$name" || exit 1
  done
  # Proceed only after the manual header/cooldown gate below has cleared.
  sleep 2
  curl --disable --silent --show-error --proto '=https' \
    --connect-timeout 20 --max-time 120 --max-filesize 5242880 \
    --user-agent 'atxdata-meeting-archives/0.1' \
    --dump-header meeting-2010-01-05.headers \
    --output meeting-2010-01-05.pdf.part \
    --write-out 'HTTP=%{http_code} bytes=%{size_download} effective=%{url_effective}\n' \
    'https://countyclerk.traviscountytx.gov/wp-content/uploads/commissioners_court/archives/2010/01052010vs.pdf' \
    > meeting-2010-01-05.outcome
)
```

The entire parenthesized block must exit successfully; never continue after a failed guard or curl by running its last line separately. `set -C` protects shell redirections, not curl's output files: the explicit absence checks plus trusted directory/owned single-writer lock are required. A failed transfer may leave a partial; it is not a downloaded document. The final file is deliberately absent until validation. A 5 MiB bound failure does not authorize raising the bound or splitting/range-downloading the body.

For discovery use the same guarded, no-clobber shape, with unique `landing.headers`, `landing.html.part`, `landing.outcome`, the official archive URL, `--max-time 90` and `--max-filesize 3000000`. For the linked CivicClerk redirect use another fresh prefix. Resolve relative links against the saved official page. Save exact anchor text and year/month context. Do not restrict future discovery to a filename pattern simply because this observation's inventory was directory-filtered.

### Mandatory gate between requests

One in-flight GET including full body consumption, with at least two seconds after every completed attempt. `--disable` must be curl's FIRST argument; no default curlrc, automatic redirects, automatic retries, parallel transfers, HEAD probes or cookie replay. Inspect headers/body before the next request, including after HTTP 200 or a redirect. No numeric quota or Retry-After appeared in this sample, not permission to accelerate. The PDF carried `X-Robots-Tag: noindex, noarchive, nosnippet`: preserve that publisher instruction, keep verification copies private, and do not publish/cache/index the PDF as part of this access skill.

Honor the longest published quota/cooldown: Retry-After seconds or HTTP date (accounting for server Date), exhausted RateLimit-Remaining/RateLimit-Reset, X-RateLimit equivalents and structured RateLimit (`r=0;t=...`), even on success. Persist the resulting not-before UTC time before stopping. Do not cap server waits; ambiguous policy means stop, not guess. A redirect is another separately gated GET to an inspected official HTTPS target; a 301 is not a retrieved archive document.

Only connection/timeouts, HTTP 408/429 or 5xx may retry, at most three extra attempts per URL across restarts. Use the maximum of the server wait, two seconds and exponential delays 2/4/8 seconds, plus fresh 0–1 second jitter calculated with a tool. Preserve each attempt's headers/outcome/partial under unique names; no append/range resume. Permanent 4xx, authentication/challenges, invalid content, guard failure or exhausted retries stop the affected acquisition with failed/BLOCKED status and exact evidence. No registration, purchase, records request or challenge bypass.

## Verify, promote and restart

Require curl exit 0, HTTP 200, expected effective URL, PDF content type, `%PDF-` magic, actual size equal to transfer size and Content-Length when present, successful `pdfinfo`/`pdftotext`, and body identification of body/date/document role. Save validation output privately. Use `pdftoppm` plus visual inspection if text is absent or conflicting. A PDF signature or landing HTTP 200 alone is not e2e verification.

For the sample, `pdfinfo meeting-2010-01-05.pdf.part`, `pdftotext -layout meeting-2010-01-05.pdf.part meeting-2010-01-05.txt`, and `shasum -a 256 meeting-2010-01-05.pdf.part` succeeded. Page 1 was rendered and inspected. Optional `qpdf --check` exited 3 with linearization/hint-table warnings; this is NOT a clean qpdf pass. Preserve original bytes rather than repairing/normalizing the evidence. Poppler parsed the ten-page document successfully.

After semantic/HTTP validation and under the same cwd/ownership guards, promote using a same-filesystem hard link that fails if the destination exists, then remove only the source partial:

```sh
python3 -c 'import hashlib, os; from pathlib import Path; p=Path("meeting-2010-01-05.pdf.part"); assert not p.is_symlink(); b=p.read_bytes(); expected="3cdb0b3a0f7e11e90ac493dc56c913516c1c3e4c38077c4d5ce6918a873c4269"; assert len(b)==119994 and b.startswith(b"%PDF-") and hashlib.sha256(b).hexdigest()==expected; final=p.with_suffix(""); os.link(p,final); p.unlink(); assert hashlib.sha256(final.read_bytes()).hexdigest()==expected and not p.exists()'
```

That hash/size is a pinned verified sample, not a universal future version constraint. A changed body requires a new observation and validation, not relaxing the check silently. Hard-link support is a prerequisite for this promotion method; never fall back to overwriting an existing final. A crash after linking but before unlinking may leave both names: verify identity/hash, then remove only the owned partial.

Keep a private provenance row for body `Travis County Commissioners Court`, meeting date `2010-01-05`, session `voting`, role `minutes`, exact source URL (stable archival identity), discovery URL/snapshot/anchor, observed title and conflicting body wording, unknown publication date, HTTP Last-Modified/ETag, PDF metadata, retrieval time, status, attempts/cooldown, size/hash and relative local filename. Keep related road-district/corporation sections distinct from Court actions; this PDF bundles several bodies. Deduplicate URL identities for discovery, and byte hashes for versions; never merge different bodies/roles solely by date or assume matching URLs mean unchanged content.

On restart recheck the owned lock, cwd, persisted cooldown and attempt budget. Skip HTTP only when the provenance status/identity and final hash/size agree. Missing/corrupt finals fail that gate. Quarantine incomplete/corrupt bytes under unique private names after confirming no active writer, then restart the full bounded transfer into a fresh partial. Do not overwrite completed evidence. A local checksum rerun does not detect remote changes. Revision checking requires a separately authorized new observation, preserving both versions and source chains. Release only this run's owned lock after recording the terminal status, including on failure.

## Actual verification and limits

2026-11-04 UTC: archive landing HTTP 200 (475847 bytes); linked legacy CivicClerk URL HTTP 301 (163 bytes); one historical PDF HTTP 200, 119994 bytes, ten pages, SHA-256 `3cdb0b3a0f7e11e90ac493dc56c913516c1c3e4c38077c4d5ce6918a873c4269`. No automatic redirects, retries or concurrency used. Landing snapshot SHA-256: `e65ced66d70f91dbc0eaf2501f215ccafc30f72b385052d2df964fa729bfda3b`.

The PDF title is “MINUTES OF MEETING JANUARY 5, 2010”; page headers and landing agree. Its opening sentence instead says “2nd day of January 2010.” Visual review confirmed the discrepancy exists in the document, not merely text extraction. Preserve the conflict; use the title/anchor date with that caveat, not an invented correction. Last-Modified was 2022-12-15; internal creation/modification metadata was in October 2022. Neither is the meeting date or a verified publication/adoption date.

A separate process verified the final checksum with zero HTTP requests. Offline-copy checks rejected a truncated/corrupt checksum, quarantined an incomplete partial and restarted from complete local bytes, rejected a second writer lock, and proved no-clobber promotion retained the original final on collision. The original self-test's broad preflight no-clobber claim was superseded by independent review, which reproduced an AND-list guard defect. The final guard makes every absence/symlink failure independently fatal; neither `set -e` nor shell noclobber alone protects curl-opened files. Keep every artifact's regular-file, resolving-symlink and dangling-symlink rejection checks distinct. These are local recovery/guard checks, not a live interrupted-transfer retry or cooldown test. Client SQLite integrity, TDD, typecheck, CRAP <10, dryer 0.8 and mutation testing are N/A to this documentation-only deliverable, not passing metrics. No production code or new persistence stack was added. Independent review is chief-owned and not claimed complete.

Supported: one repeatable bounded manual discovery/acquisition path with private provenance, content verification and file-level restart. Not supported/established: complete history, broad PDF availability, cross-system deduplication, automatic remote revision tracking, live transient recovery, unattended retry/lock handling, video, agendas/packets for historical meetings, or any additional vendor archive.
