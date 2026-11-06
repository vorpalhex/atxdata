# Travis County budget acquisition

Intent: an agent-operated, bounded fiscal-year inventory and direct-file workflow, not a new client or unattended crawler. LLM-assisted contribution. No account, API key, Bun installation or new persistence service is needed. Acquisition and OCR/text extraction are separate steps.

## When to use

Use for a small, explicitly selected set of county budgets and policy PDFs. For unattended scheduling, broad backfills or automatic revision detection, first build a Bun client with SQLite source/history/run/download state; this manual workflow does not implement those features.

## Prerequisites

Use `terminal`, `read_file` and `write_file`. The verified commands require a POSIX shell, curl, Poppler (`pdfinfo`, `pdftotext`), `od` and `shasum`; this reference was exercised on macOS. Obtain an operator-approved private archive directory outside the checkout. Do not use source directories, even ignored ones, for downloads, inventories or logs. No credential, cookie replay or operator identity is required.

Set `archive_directory` and `run_directory` as tool working-directory arguments to real approved locations; these names below are non-resolving placeholders, not paths to copy. Use a fresh observation directory per run, with a UTC observation timestamp. Store original HTML, headers, request outcomes, file bytes and a private inventory there. Limit the initial run to two PDFs and three discovery pages; expansion requires an explicit year/file bound.

## Discovery

1. Acquire a single-writer lock before source requests: `terminal(command="mkdir .budget-lock", workdir=archive_directory)`. An existing lock stops the workflow. Do not remove another writer's lock; after a crash, confirm no writer is active before the operator removes it. Keep the lock across all discovery, downloads and ledger updates; release with `rmdir .budget-lock` only when finished or safely stopped.
2. Fetch the official current-year page with the command below. Use `read_file` to inspect the saved HTML and headers, not merely curl's exit status. Require HTTP 200 and substantive budget links. Follow only verified official HTTPS links; never guess year-based filenames. Treat redirects as a new request subject to the pacing/cooldown procedure, not automatic `--location` requests.
3. Fetch the department index and its linked archive page in the same way, one at a time, changing the URL and local `source` prefix. Save all three snapshots. Resolve relative links against their source page. Inspect fiscal-year headings and link text together; older archive entries may lack a year in the anchor itself. Enumerate and deduplicate the selected year's links, reconcile counts with the saved page, and record any missing document categories explicitly. Include all in-scope official document links regardless of directory; do not restrict future discovery to `/images/planning_budget/`.

Run each request through `terminal` in the private observation directory. This is the exact discovery request shape (replace only the verified URL and simple local prefix):

```python
terminal(command="sleep 2; curl --disable --silent --show-error --proto '=https' --connect-timeout 20 --max-time 90 --max-filesize 10000000 --user-agent 'atxdata-budget-verification/0.1' --dump-header source.headers --output source.html.part --write-out 'HTTP %{http_code}; bytes %{size_download}; effective %{url_effective}\\n' https://www.traviscountytx.gov/planning-budget/current-year", workdir=run_directory, timeout=120)
```

Retain command output/exit status privately. Only rename `source.html.part` to `source.html` after checking HTTP status, body and transport success. Never overwrite an earlier snapshot.

Verified discovery routes on 2026-11-04:

- Current documents: https://www.traviscountytx.gov/planning-budget/current-year
- Department index: https://www.traviscountytx.gov/planning-budget
- Prior-year documents: https://www.traviscountytx.gov/planning-budget/archives
- The index also linked `budget-development` and `policies-rules` under the department; these were not fetched in this bounded verification.

Current-year advertised FY 2027 (tax year 2026), with seven PDF links: adopted budget, budget/tax-rate information, taxpayer-impact statement, budget rules, preliminary budget, recommendations and guidelines. Recommendations used a `v2` filename; guidelines included a date in the filename. Neither proves a publication date or a complete revision history. The archive linked FY 2026 adopted volumes I–IV, preliminary budget, recommendations, guidelines, rules, tax information and budget-in-brief translations, among older holdings. Do not assume every year has the same categories or one adopted-budget volume.

The saved archive discovery inventory counted 109 link occurrences / 108 unique URLs **filtered to `/images/planning_budget/`** (including legacy text files), not all archive documents. Budget-relevant PDFs also occur under `/images/news/docs/` and directly under `/images/`; those locations are not excluded from future discovery. The filter is an evidence-count scope, not a county holdings boundary or a rule for selecting future links.

## Pacing, retries and stopping

There must be only one in-flight request, including body consumption. Keep `--disable` as curl's first argument to suppress default curlrc options that could silently add redirects, retries, URLs, cookies or authentication outside the manual gate. Leave at least two seconds after each completed attempt; no parallel calls, HEAD probes, automatic redirects or automatic curl retries. This deliberate manual gate permits inspection before another request. No numeric published quota was present in the sampled responses; that is not permission to accelerate.

Before EVERY subsequent request, inspect the preceding headers for `Retry-After`, exhausted `RateLimit-Remaining`/`RateLimit-Reset`, `X-RateLimit-*` and structured `RateLimit` policies (`r=0;t=...`). Wait for the longest instruction, including on HTTP 200. HTTP-date Retry-After must account for the server Date header. If a quota or reset is ambiguous, stop and ask rather than ignore it. Server waits have no artificial cap. Persist the not-before UTC time in the private run notes before a long cooldown or stopping, and honor it on restart even in a different shell/run directory.

Retry only transport/timeouts, HTTP 408/429 and 5xx, at most three additional attempts per URL/run. Before each retry use the larger of the server cooldown, two seconds and exponential backoff (2, 4, 8 seconds respectively), plus a newly sampled 0–1 second jitter. Calculate waits with a tool, not mentally; for example `terminal(command="python3 -c 'import random; print(4 + random.uniform(0, 1))'")` samples the second retry's local delay, before applying any longer server instruction. Record attempts and outcomes. Repeated transport failures consume the same finite budget across restarts; do not reset it by rerunning curl. Permanent 4xx, an HTML challenge, authentication, invalid PDF or exhausted retries stop that file with a clear failure record. Never bypass challenges or register/pay/submit a records request.

## Acquisition and version inventory

For each selected link, use `write_file` to record a private inventory row BEFORE downloading:

- Official discovery page URL and snapshot filename; observation time in UTC; exact anchor text and resolved source URL (stable public source identity).
- Fiscal year, tax year separately where stated, document type, volume/language, and any filename revision label. Do not collapse recommendations into preliminary budgets or Bee Cave Road District documents into county budgets.
- Publication/revision date only when explicitly stated; otherwise null/unknown. Keep filename dates, HTTP Last-Modified, PDF creation/modification metadata and retrieval time as separate evidence, never substitutes for official publication dates.
- Status (`pending`, `downloaded`, `failed`, `verified-existing`), attempts, next permitted request time, HTTP outcome, effective URL, content type, byte count, SHA-256 and local relative filename after verification. Keep prior observations/versions, including removed links; URL identity alone does not prove unchanged bytes.

For the verified adopted-budget link, the full-body command is:

```python
terminal(command="sleep 2; curl --disable --silent --show-error --proto '=https' --connect-timeout 20 --max-time 180 --max-filesize 52428800 --user-agent 'atxdata-budget-verification/0.1' --dump-header fy2027-adopted.headers --output fy2027-adopted.pdf.part --write-out 'HTTP %{http_code}; bytes %{size_download}; effective %{url_effective}\\n' https://www.traviscountytx.gov/images/planning_budget/Docs/2027/FY_2027_Adopted_Budget.pdf", workdir=run_directory, timeout=210)
```

Use this same shape for other selected links with unique local names. The 50 MiB/180-second bounds stop unexpectedly large transfers; a bound failure is not success and does not authorize increasing it automatically. Use trusted directories, simple local filenames and no symlink targets. Never derive filesystem paths from server filenames.

Validate BEFORE promoting the partial file:

```python
terminal(command="od -An -tx1 -N5 fy2027-adopted.pdf.part && pdfinfo fy2027-adopted.pdf.part && pdftotext -f 1 -l 3 fy2027-adopted.pdf.part - && shasum -a 256 fy2027-adopted.pdf.part", workdir=run_directory)
```

Require curl success, HTTP 200, PDF content type, `%PDF-` signature (hex `25 50 44 46 2d`), successful PDF parsing and body text identifying the requested county/year/type. Compare transfer size with the actual file and Content-Length when present. Signature alone is insufficient. Save validation outputs privately; do not extract/OCR the entire corpus as part of acquisition. If textual identification is unavailable, inspect rendered pages before claiming semantic verification.

After validation, verify the final destination does not exist (including a dangling symlink), then `terminal(command="mv -n fy2027-adopted.pdf.part fy2027-adopted.pdf", workdir=run_directory)`. Source and destination must be on the same filesystem; verify the final file checksum and absence of the partial afterward. Update the private inventory to downloaded only then. If a final path already exists, stop rather than overwrite it.

## Restart, rerun and revision checks

Use `write_file` to save `checksums.sha256` in standard shasum format, one verified hash and relative final filename per line. In the SAME selected observation, restart by validating the completed files:

```python
terminal(command="shasum -a 256 -c checksums.sha256", workdir=run_directory)
```

Skip a file without HTTP only when its inventory status, identity, local bytes and checksum agree. A checksum file alone is not provenance. Missing/corrupt files fail the skip gate. Preserve corrupt finals as failed evidence in a separate private location; retry into a fresh partial. Never append to an orphan `.part`: after confirming no writer, discard or quarantine only that incomplete file and restart its bounded transfer. Already verified files stay untouched. This is file-level restart/resume, not byte-range resume or automatic scheduling.

A new revision check is a NEW observation: refetch approved discovery pages and selected PDFs into fresh names, following pacing and cooldowns. Compare hashes with prior versions, retain changed bytes and both observations, and record unchanged hashes without erasing provenance. Local checksum skipping does not detect remote changes; no conditional GET/ETag guarantee or complete revision history is claimed.

## Verification and limits

Live verification, 2026-11-04 UTC: three substantive HTML snapshots and two FY 2027 PDFs acquired anonymously, serially, without redirects or retries. All five returned HTTP 200; no sampled Retry-After/rate-limit headers. Discovery exposed all seven current categories and prior-year direct links, but only the following files were downloaded:

| Document | Bytes | Pages | SHA-256 |
| --- | ---: | ---: | --- |
| FY 2027 adopted budget | 29652053 | 511 | `61d311a8d65f5e58cfcc266d09f06cc73f6c7ec40e0997eea3c48b114272e2f8` |
| FY 2027 taxpayer-impact statement | 127112 | 1 | `566b43f130ab8395088d566edd6df788a99322a3c385c758b536d4ed4321f5a3` |

Impact statement source: https://www.traviscountytx.gov/images/planning_budget/Docs/2027/FY_2027_Tax_Rate-impact-statement.pdf

Both parsed with Poppler and body text identified FY 2027/Travis County. The adopted PDF's internal title still says “Proposed”; the landing-page label and body say adopted. Preserve this conflict rather than deriving document status from PDF title alone. The impact statement discusses a proposed budget; do not silently relabel it as an adopted-budget statement. Last-Modified was 2026-09-29 for adopted and 2026-10-01 for impact, not verified publication dates.

A separate-process rerun returned both files OK with zero source requests. Offline private-copy checks rejected a truncated PDF/checksum, rejected a second writer's lock, discarded an orphan partial without changing verified finals, and verified same-directory no-clobber promotion. `mv -n` can return success while leaving a partial when a final exists: the explicit postchecks are required. Keep raw evidence and inventory private. Independent review remains a separate gate, not satisfied by this procedure's self-check.

Supported: manual bounded year/type/link inventory, public direct-file acquisition, integrity/provenance evidence and file-level restart. Not implemented: unattended client, SQLite state (not applicable without a client), automated retry/revision logic, exhaustive historical enumeration, archive PDF validation beyond the sample, OCR or financial interpretation. TDD, TypeScript typecheck, CRAP, structural duplication and mutation tools are code-only gates and are not applicable to this documentation-only deliverable; do not report them as passing.
