# Travis County Code acquisition

Implementation update (bounded implementation; independent review pending): `programs/county-documents-consume/` provides one Bun/SQLite acquisition engine with four explicit adapters, bounded discovery/collect/sync, status and zero-HTTP verification. See its README for setup, exact limits, source scope, private headers/originals and fail-closed manual recovery. The earlier manual procedure/evidence below remains historical; it is not a claim of complete archive availability.

Collector retained-original proof: landing80 occurrences/80 unique current chapter URLs, chapters2/464 parsed/imported with unchanged reference hashes and original headers; duplicate and zero-HTTP selected verification pass. Title/subtitle and sparse chapters retained. Chapter2 body explicitly says amendments added through August16,2022; Chapter464 says it was amended October21,2025, stored as separate scoped date evidence, not blanket effective/publication dates. No fresh chapter requests, historical bodies or Title30 incorporation. Recovery is explicitly fail-closed/manual at retained checkpoints. Independent review/card acceptance remain pending.

Intent: bounded, agent-operated discovery and direct chapter-PDF acquisition for citable policy research. LLM-assisted contribution. This standalone procedure is not an unattended client or a full historical archive. It reuses the repository's manual-budget safety conventions; County Code evidence was acquired independently.

## Authority and supported scope

Start at https://www.traviscountytx.gov/commissioners-court/county-code . The county warns that this online copy is **not official**, may be inaccurate and is for reference only. Commissioners Court Minutes in the County Clerk's Office maintains the official paper record. Do not present a downloaded PDF as certified or authoritative legal advice.

The landing page groups current reference PDFs by title, subtitle and chapter, links searchable enCodePlus code, and links a separate Title 30 Austin/Travis County subdivision code. Chapter numbers are sparse, not a sequence to generate. Do not infer filenames, merge Title 30 into county chapter coverage, or mistake an org-chart PDF in the footer for a code chapter.

Historical scope is uncertain beyond land development. The county explicitly says only Title 2 land-development chapters have online historical versions and directs other past-version inquiries to Commissioners Court Minutes. The linked archive selector now contains some non-land-development labels too; that is a discovery discrepancy, NOT proof of historical content or complete history for those chapters. No records request is authorized by this procedure.

## Prerequisites and private state

Use `terminal`, `read_file`, `write_file`, a POSIX shell, curl, Poppler (`pdfinfo`, `pdftotext`), `od`, `shasum`, and Python 3 for offline link/count checks and jitter calculation. No account, cookie replay, API key, Bun installation or SQLite service is required. Inspect the existing clients before adding automation; broad/unattended collection needs a separately tested Bun/SQLite client for source/history/run/download state, not JSON manifests.

Obtain an approved private archive outside the checkout. In the examples, `archive_directory` and `run_directory` are non-resolving tool working-directory placeholders; set them to real approved locations, never source directories. Use a fresh UTC-dated observation directory, trusted non-symlink destinations and simple chosen filenames. Keep raw HTML/PDFs, headers (potentially cookies), extracted text, inventories, scans and logs private.

Acquire a single-writer lock in the common archive with `terminal(command="mkdir .county-code-lock", workdir=archive_directory)`. An existing lock stops work. Hold it through all source requests and inventory updates. After a crash confirm no writer remains before the operator clears a stale lock. Release using `rmdir .county-code-lock` only after state is saved and acquisition has stopped.

Before any request, record the selected URLs, document/page bounds, attempts and next-permitted-request UTC time in private notes. Initial verification is bounded to the landing page, archive selector and at most two chapter PDFs. A later expansion requires an explicit chapter/date/file bound.

## Serial request gate

One in-flight request at a time, including the complete body. The first curl argument is `--disable`, intentionally suppressing default curlrc settings so redirects, retries, extra URLs, cookies and authentication cannot silently bypass the manual gate. Leave at least two seconds after every completed attempt. No parallel discovery, HEAD probes, automatic redirects, automatic curl retries or byte-range resume. Inspect headers and body BEFORE another request, including after HTTP 200.

Honor the longest `Retry-After`, exhausted `RateLimit-Remaining`/`RateLimit-Reset`, `X-RateLimit-*`, structured `RateLimit` (`r=0;t=...`) or published quota instruction. Account for server `Date` when interpreting HTTP-date Retry-After; standard reset is a delay, legacy X reset may be an epoch. Stop on ambiguous quota instructions instead of guessing. Server cooldowns have no artificial cap: save the not-before UTC time in archive-wide private notes and honor it across shells/restarts. A two-second sleep alone does NOT implement server cooldowns.

Retry only transport/timeouts, HTTP 408/429 or 5xx, at most three additional attempts per URL/observation across restarts. Before retrying, wait the maximum of server cooldown, two seconds and exponential backoff (2, 4, 8 seconds), plus fresh 0–1 second jitter calculated with a tool, e.g. `python3 -c 'import random; print(4 + random.uniform(0, 1))'`. Log each attempt/outcome and retain failed evidence. Permanent 4xx, challenge HTML, authentication, invalid PDFs and exhausted retry budgets stop the file with a clear failure. Do not bypass challenges, register, pay or submit forms/records requests.

Redirects require inspection and a separately paced request to a verified official destination; never add `--location` without redesigning that gate. No numeric quota or cooldown headers occurred in this sample; that is not permission to accelerate.

## Discovery and historical interface

Run the following exact request shape through `terminal` in the private observation directory:

```python
terminal(command="sleep 2; curl --disable --silent --show-error --proto '=https' --connect-timeout 20 --max-time 90 --max-filesize 10000000 --user-agent 'atxdata-county-code-verification/0.1' --dump-header landing.headers --output landing.html.part --write-out 'HTTP %{http_code}; bytes %{size_download}; effective %{url_effective}\\n' https://www.traviscountytx.gov/commissioners-court/county-code", workdir=run_directory, timeout=120)
```

Require curl success, HTTP 200 and substantive chapter links, not merely a wrapper or challenge. Inspect headers under the gate above; promote the snapshot to `landing.html` without overwriting any prior observation. Parse anchors with an HTML parser, resolve relative URLs against the page URL, retain exact anchor labels and surrounding title/subtitle headings, and deduplicate resolved URLs. Select chapter anchors explicitly; do not filter all PDFs indiscriminately. Save the private link inventory and reconcile occurrences and unique URLs. This page has no chapter-list pagination; do not claim remote holdings completeness from its list.

The landing's Code Archives anchor was literally `http://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx`. Preserve that original value in provenance. Its explicitly tested secure transport equivalent is https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx . Fetch it using the same request shape, changing the URL and local prefix to `archive`; do not silently rewrite the source anchor or send cookies from the county host.

The landing's searchable-code anchor was `http://online.encodeplus.com/regs/traviscounty-tx/index.aspx`; the archive HTML also advertises `/regs/traviscounty-tx/doc-viewer.aspx` and `/regs/traviscounty-tx/search.aspx`. These are discovered routes, not exercised search/export interfaces.

The archive HTML exposes a date field named `effectiveDate` and an ordinance selector named `ordinance`, inside `archiveDialogForm`. Preserve option value AND exact label: values repeat across labels and dates can disagree with dates embedded in labels. The calendar's static month is not an archive boundary. Count non-placeholder option occurrences and unique values separately. This verification did not submit the form, exercise archived document retrieval, fetch viewer/search pages or validate a historical chapter. Do not invent a GET API or promise a historical PDF export. A later separately authorized browser inspection may select a bounded date/ordinance and verify resulting document/version content; first inspect the actual navigation rather than constructing endpoints.

## Chapter acquisition and identity

BEFORE each transfer, record a private inventory row with:

- Discovery URL and saved snapshot; exact anchor label; title/subtitle/chapter number and title; exact resolved source URL.
- Observation UTC time, current-reference versus historical-selection status; archive date/ordinance value and label if actually selected (otherwise unknown/not selected).
- Explicit body amendment-through date and meeting/item, adoption/effective dates with scope, and any filename revision label. Unknown publication dates remain unknown. HTTP Last-Modified, PDF creation/modification dates and retrieval time are separate evidence, not publication or amendment dates.
- Pending/downloaded/failed/verified-existing status; attempts, next-permitted request time, HTTP status, effective URL, content type, byte count, SHA-256 and chosen relative final filename. Preserve prior observations even when a URL is unchanged.

Verified Chapter 2 full-body command:

```python
terminal(command="sleep 2; curl --disable --silent --show-error --proto '=https' --connect-timeout 20 --max-time 180 --max-filesize 52428800 --user-agent 'atxdata-county-code-verification/0.1' --dump-header chapter-002.headers --output chapter-002.pdf.part --write-out 'HTTP %{http_code}; bytes %{size_download}; effective %{url_effective}\\n' https://www.traviscountytx.gov/images/commissioners_court/Doc/county-code/subtitle1/Ch._2_Code_Interpretation_Amendment_and_Publication.pdf", workdir=run_directory, timeout=210)
```

For the second verified selection, use the same command shape with local prefix `chapter-464` and this source URL: https://www.traviscountytx.gov/images/commissioners_court/Doc/county-code/subtitle19/Ch_464_Floodplain_Management.pdf . Recheck the current landing before future use. The 50 MiB/180-second bounds stop unexpectedly large transfers; do not silently increase them. Never derive filesystem paths from server filenames.

Validate BEFORE promoting each partial, substituting the chosen simple local name:

```python
terminal(command="od -An -tx1 -N5 chapter-002.pdf.part && pdfinfo chapter-002.pdf.part && pdftotext -layout chapter-002.pdf.part chapter-002.txt && shasum -a 256 chapter-002.pdf.part", workdir=run_directory)
```

Require curl success, HTTP 200, PDF content type, `%PDF-` signature (hex `25 50 44 46 2d`), successful PDF parsing and body text identifying the requested county/chapter and amendment status. Compare actual bytes with transfer size and Content-Length when present. Inspect first/last physical pages and amendment footnotes, not PDF metadata alone; verify extracted page count against `pdfinfo`. Text is a search aid, not proof of table fidelity. If extraction is empty or identification is missing, inspect rendered pages before claiming semantic verification; no hosted OCR is authorized here.

In the trusted, locked directory, require the final path to be absent including dangling symlinks, then promote on the same filesystem:

```python
terminal(command="test ! -e chapter-002.pdf && test ! -L chapter-002.pdf && mv -n chapter-002.pdf.part chapter-002.pdf && test ! -e chapter-002.pdf.part && shasum -a 256 chapter-002.pdf", workdir=run_directory)
```

Confirm the final checksum matches the validated partial and mark downloaded only then. `mv -n` may exit zero while leaving the partial when a final exists; the pre/postchecks are mandatory. Never overwrite an earlier version.

## Restart and revision checks

Save `checksums.sha256` privately in standard shasum format, one verified hash and relative final filename per line. In a new process run `shasum -a 256 -c checksums.sha256` from the same observation directory. Skip without HTTP only when the inventory identity/status and local checksum agree. Missing or corrupt finals fail that gate; preserve them privately as failed evidence before a fresh bounded transfer. After confirming no writer, quarantine/discard only orphan partials and restart full transfers; never append or treat them as completed. Keep attempt budgets and server cooldowns across restarts. This is file-level restart, not byte-range or automatic resume.

A remote revision check is a NEW observation: refetch bounded discovery and selected documents to fresh names, compare hashes, retain changed bytes plus both observations, and record unchanged hashes without losing provenance. Local checksum skipping cannot detect remote changes. A URL, Last-Modified or amendment date alone is not a version identity; pair chapter/declared amendment identity with the body hash.

## Actual verification and limits

Live verification: 2026-11-04 UTC; two discovery pages and exactly two chapter PDFs, all HTTP 200, serial anonymous full transfers, no redirects/retries/cookie replay. Landing inventory: 80 chapter-PDF anchors / 80 unique URLs; 81 total PDF links includes an unrelated footer org chart. Archive selector: 157 non-placeholder option occurrences / 127 unique values, labels spanning 1995-03-28 to 2026-09-15. These are HTML inventory counts, not verified historical versions or an exhaustive amendment chronology. Recent labels include Chapters 26/32/114/135, contradicting any assumption that the selector labels only land-development chapters; historical availability for those chapters remains unverified.

| Current reference | Body amendment-through identity | Bytes | Pages | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Chapter 2, Code Interpretation, Amendment, and Publication | August 16, 2022, Item 25 | 247899 | 15 | `12e09fbf334455d038aade4cba3a7a6e9ff54b790aef1f8953067d6ceddbc806` |
| Chapter 464, Regulations for Floodplain Management and Guidelines and Procedures for Development Permits | October 21, 2025, Item 45 | 411612 | 64 | `bb112d2ca93a32a96c05185bbcf585596067ce59722b12f0ed621ed1953bac6a` |

Both parsed locally with Poppler; extracted physical-page counts matched 15/64. Chapter 2's first footnote states adoption July 2, 2013, Item 18. Chapter 464 states replacement/effect April 30, 2019, Item 30, and later amendment October 21, 2025, Item 45; do not apply the original effective date to every later amendment. HTTP Last-Modified was 2022-08-18 and 2025-11-17 respectively, not verified publication dates.

A separate-process checksum rerun returned both files OK with zero source requests. Private offline-copy recovery checks rejected a second writer and a truncated PDF/checksum, preserved a verified final during no-clobber promotion, and removed an orphan partial without changing final bytes. These are manual safety checks, not an automated collector's test suite. Historical content, all other chapter bodies, search behavior, official paper verification, remote revision monitoring and complete historical coverage remain unverified/unimplemented.

No production code was added: TDD, TypeScript typecheck, CRAP/coverage, structural duplication at 0.8, mutation testing and SQLite integrity are code-only gates, N/A rather than passes. Validate commands, local documentation links, exact counts/hashes and sanitized changes. Independent review is a separate chief-owned gate, not satisfied by the implementation's own checks.
