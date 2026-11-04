---
name: travis-county-public-data-access
description: "Use when accessing Travis County public data."
version: 0.1.0
author: vorpalhex, Hermes Agent
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [research, government, public-data, travis-county, ingestion]
    related_skills: [exhaustive, pdf-to-text, finding-highlights]
---

# Travis County Public Data Access

Locate, assess, and collect public Travis County government data. Use this as a living source and connector inventory, not a claim that every county holding has been enumerated or downloaded. Travis County Commissioners Court is distinct from Austin City Council; the former uses CivicClerk, while this repository's Austin client uses Legistar.

## When to Use

- Finding official county records, choosing the next collector, or explaining acquisition gaps.
- Collecting Commissioners Court documents or investigating budgets, spending, contracts, geography, property, courts, elections, and campaign finance.
- Updating access findings and implementation status after building or verifying a client.

## Prerequisites

Resolve the repository root and inspect `programs/` before asserting which collectors exist. Bun is required for the current CivicClerk client. Use `web_search`, `web_extract`, `terminal`, and, when necessary, browser tools for new reconnaissance; no account or API key is required for the tested CivicClerk endpoints.

Read [the source inventory](references/sources.md) for primary URLs, data types, access evidence, outstanding work, and the unquantified request-only long tail. Source reconnaissance was performed on 2026-11-01; connector paths were checked on 2026-11-02. The [standalone TNR GeoHub procedure](references/tnr-geohub.md) was verified on 2026-11-04: bounded public catalog discovery and one four-polygon layer, with selected attributes, original geometry/schema/SR, and count/object-ID reconciliation. It is manual access, not a full GIS collector or county-wide archive. Revalidate dynamic sources before relying on them.

## Current Connector

`programs/civicclerk-consume/` provides public event listing and serial downloads of published agenda, packet, minutes, and transcript PDFs. It uses SQLite meeting/document/run records, checksums, atomic partial files, tenant-bound output directories, server cooldowns, and exponential-jitter retries. See `programs/civicclerk-consume/README.md` for the exact commands and settings; paths in this paragraph are relative to the repository root.

Run through `terminal` with the working directory set to the resolved program directory:

```python
terminal(command="bun install --frozen-lockfile && bun test && bun run typecheck", workdir=program_directory)
terminal(command="bun run src/cli.ts list-meetings --from 2021-01-05 --to 2021-01-05", workdir=program_directory)
```

For ingestion, get the operator's approved archive destination and pass it as `--output` to `ingest-meeting --event-id ID`. Do not start an unbounded backfill. Preserve source documents outside the publishable tree. A single successful meeting does not establish complete historical coverage. Video, richer agenda-item/vote extraction, and legacy archive collection are not implemented by this client.

## Budget Access Workflow

For bounded fiscal-year budget inventories and direct PDFs, follow [budget acquisition](references/budgets.md). This verified agent-operated workflow uses serial curl requests, explicit cooldown gates, a private version inventory, atomic file promotion and checksum-verified local reruns. It is not an unattended client; no new program or SQLite database is introduced. On 2026-11-04, three official discovery pages and two FY 2027 PDFs were acquired and verified. Other years/types and complete revision history remain uncollected. Use the linked procedure's POSIX/Poppler prerequisites, not the CivicClerk commands above.

## County Code Access Workflow

For bounded current chapter PDFs and historical-interface discovery, follow [County Code acquisition](references/county-code.md). This standalone agent-operated workflow preserves chapter/amendment identity, source URLs and hashes, with serial curl transfers, manual cooldown gates, private provenance and file-level restart. On 2026-11-04, the landing and linked archive selector were inspected and current-reference Chapters 2 and 464 were acquired and parsed. Historical bodies and other chapters remain unverified. The online code is not the official paper record; archive labels do not establish history for every chapter. No new client or SQLite service is introduced; use the linked procedure's POSIX/Poppler prerequisites.

## Tax Office Bulk Access

For a bounded delinquency snapshot, use [the standalone supervised curl procedure](references/tax-office-bulk-access.md). On 2026-11-04 it acquired a complete small delinquency CSV and the published layout, validated 7,285 rows and text account IDs, and exercised checksums/full-restart recovery. This is a verified access skill, not an automated collector or complete yearly roll archive. Current/prior rolls, rates/exemptions acquisition and TCAD integration remain separate work; keep taxpayer rows and response headers private.

## TCAD Appraisal Export Access

For TCAD, a separate appraisal district, follow [bounded public exports](references/tcad-exports.md). On 2026-11-04, explicit expanded authorization permitted one complete 557228168-byte certified appraisal ZIP: all 21 members passed streamed integrity checks; the first 25 Property rows matched the retained bulk layout, with positive valuation amounts and string year/supplement identity. The earlier small waterfront CSV and layout ZIP remain separate evidence. Supplemental/JSON bodies and complete historical/data-quality coverage remain unverified. This is a supervised skill, not an unattended collector. It enforces checkpoint/attempt-aware no-request boundaries, rejects header symlinks, and documents ten-second pacing plus longer server cooldowns; reuse the verified archive offline, never repeat its GET.

## Election Publication Workflow

For bounded official VoteTravis result/reconciliation PDFs, follow [election document acquisition](references/election-documents.md). On 2026-11-04, the official page and its historical section were inspected and two June 11, 2022 local runoff PDFs were acquired, parsed and visually verified. This manual procedure preserves official versus unofficial labels, jurisdiction, report/attestation identity, unknown publication dates and hashes. Other elections, the selected precinct PDF, complete revision history and structured Clarity extraction remain unverified here; no election client is added.

## Commissioners Court Message Board

For public discussion threads distinct from adopted Court actions, follow [message-board access](references/court-message-board.md). On 2026-11-04 a bounded anonymous curl observation verified one topic's two public posts against its category's one-reply count and single-page controls, with stable topic/post IDs and private authorship/timestamp provenance. The selected topic had no attachments; attachment retrieval, multi-page enumeration and full forum/history coverage remain unverified. This is a supervised manual access procedure, not a new client or complete archive.

## Voter Registration Maps Access Workflow

For one published non-personal electoral geographic layer, follow [Voter Registration Maps acquisition](references/voter-maps.md). Verified directly against this hub on 2026-11-04, this manual workflow discovers the voter hub's own catalog and downloads one small published Election Precincts shapefile ZIP. Its 308 unique precinct records, complete original geometry, native PRJ, district identity, schema and publication metadata were retained privately and validated; a size-limit failure/full-transfer recovery and offline checksum rerun were exercised. It is not a voter-roll collector, automated client or complete electoral archive. Other linked services/maps remain discovery-only; use the procedure's private pyshp environment and explicit serial transfer/cooldown gates.

## Structured Clarity Results

For actual vendor catalog discovery and one small structured election snapshot, use [Clarity results access](references/clarity-results.md). On 2026-11-04 the officially linked frontend led to 17 catalog EIDs and election `125662`, version `367565`: one full Detail XML ZIP with two contests and precinct/vote-type rows, reconciled against the interface's JSON. Selected visible audit material was inspected, but audit-versus-XML population, cutoff and version equivalence is not established. The audit reports zero discrepancies between its own selected electronic and hand tallies; no election-error inference follows from cross-document values. Official/final/reporting metadata is preserved without inferring certification. Numeric municipal IDs, complete history and certification remain unresolved. This supervised skill is not a Bun/SQLite collector; raw evidence remains private.

## Historical Commissioners Court Minutes

For older meetings outside the verified modern sample, follow [historical minutes access](references/meeting-archives.md). On 2026-11-04 the official clerk archive exposed static PDF links in 1996–2010 directories; its “2011 to Present” CivicClerk link returned a redirect to the modern portal. One January 5, 2010 voting-session minutes PDF was acquired, parsed and visually checked, with private source-chain/hash evidence and local restart/no-clobber checks. The PDF contains a conflicting opening-sentence date and qpdf linearization warnings, retained as caveats. This is a supervised bounded access procedure, not a new client, complete historical coverage or proof of modern start-date availability. Raw records and headers remain private; use the standalone procedure's POSIX/curl/Python/Poppler prerequisites.

## Planning Coverage Model

These are subjective weights for useful county-government monitoring, not measured shares of documents, bytes, departmental holdings, engineering effort, or public availability. They sum to 100 points. Treat them as a starting allocation, not objective completion metrics.

| Source bucket | Planning weight | Repository connector state |
| --- | ---: | --- |
| Commissioners Court decisions and meeting records | 15% | CivicClerk PDF/event collection implemented; broader coverage incomplete |
| Budgets and budget policy | 10% | Verified manual access workflow + two FY 2027 PDFs; no automated client |
| Actual spending and financial transparency | 15% | Not implemented |
| Procurement and contracts | 10% | Not implemented |
| GIS and infrastructure geography | 10% | Verified bounded TNR manual access procedure; no automated GIS client |
| Property taxes and appraisal data | 10% | Tax Office delinquency and TCAD one-certified-snapshot access verified; history/all-row validation not implemented |
| Courts and justice data | 10% | Not implemented |
| Recorded instruments and land records | 10% | Not implemented |
| Elections | 5% | Verified bounded VoteTravis publications, Clarity structured snapshot and electoral-geography access; no automated election client |
| Campaign finance | 5% | Not implemented |

Initial discussion assigned roughly 10 points of the 15-point meeting bucket to the working downloader: approximately 10% implemented and 90% remaining in this model. This is a planning placeholder, not proof that a tenth of county records has been acquired. Other departmental and request-only holdings have no measured denominator. Do not silently convert these guesses into factual progress statistics.

## Procedure

1. Establish the question, relevant date range, and source bucket. Start with the county's [official open-data directory](https://www.traviscountytx.gov/open-data-portal), then follow departmental or officially linked vendor sources.
2. Inspect the matching source-inventory entry and existing client. Distinguish three states: publicly available, repeatably collectible with our code, and actually archived. State which has been verified.
3. Revalidate access read-only. Fetch one small public page/query and, where practical, a sample file. Inspect its body: a successful dashboard wrapper is not an exported dataset. Keep probes, logs, databases, and original downloads out of publishable source. Never submit records requests, registrations, purchases, or other forms without operator authorization.
4. Grade acquisition separately from parsing: **trivial** means anonymous HTML/direct files; **medium** means APIs, pagination, searches, sessions, or dashboard acquisition; **hard** means observed anti-agent gates, required payment/identity disclosure, physical attendance, or staff-mediated retrieval. Large files and OCR do not themselves make acquisition hard. Mark unresolved paths provisional.
5. Prefer published bulk exports over record-by-record scraping. Preserve serial full-body transfers, explicit pacing, server rate-limit instructions, bounded transient retries with jitter, safe filenames, and resumable SQLite state. Inspect existing client/storage/test conventions before adding a neighboring collector; reduce feature scope rather than substituting a new persistence model.
6. Verify the requested outcome: offline boundary/recovery tests, typecheck, and a small live acquisition when authorized. Check signatures, counts, checksums, persistent status, and rerun behavior; report incomplete enumeration and archival gaps honestly.
7. Update this skill in the same change as a new client or materially changed access finding, using the maintenance checklist below. Do not mark a source implemented merely because its landing page loads.

## Suggested Next Work

1. Budget PDFs: extend the verified manual sample to an explicitly bounded year/type inventory; automate only if repeated operational needs justify a SQLite client.
2. Payments and contracts: high-value investigation for connecting approvals, vendors, and actual spending; complete exports remain unverified.
3. GIS plus tax/appraisal exports: geographic context with relatively tractable acquisition.

Meetings, budgets, spending, and procurement together account for 50 points in the planning model. This is a monitoring milestone, not an estimate of half the county's records.

## Maintenance Checklist

When a client is added or changed:

- Update its inventory entry with the repository-relative program path, supported records/date scope, commands/documentation, and known omissions.
- Record the verification date and distinguish file/query obtained, interface-only inspection, unresolved access, implemented collector, and actual archival coverage.
- Record pagination/completeness checks, download/checksum/resume verification, and any observed access restrictions; never record credential values or private names/paths.
- Change the summary table and partial-credit discussion only when justified. If weights change, sum them and derived totals using `terminal` or `execute_code`; retain the subjective-denominator warning.
- Refresh primary URLs and remove superseded routes only after testing replacements. Keep sources authoritative; distinguish county departments, TCAD, City of Austin, and other jurisdictions.
- Keep the main skill concise; extend `references/sources.md` for source-specific details. Do not create unrelated root reports or regenerate unrelated documentation.

## Pitfalls

- An unimplemented connector is not proof that public access is blocked. An API callable with curl is still medium on this acquisition scale.
- A page reporting HTTP 200 may contain only an application shell. Do not claim a bulk export until actual data is obtained and enumeration is checked.
- One browser's WAF block does not establish a universal prohibition. Do not bypass challenges or assume filing/submission security requirements apply to public viewing.
- Free viewing, unofficial copies, certified copies, and staff searches have different access/fee rules. Do not describe an entire record class as paywalled because one copy service costs money.
- County Code PDFs are reference copies, not the official paper record. Campaign-finance filings and personal financial disclosures are different records with different access rules.
- Public data can still contain personal information. Scope collection to the monitoring task and sanitize any material intended for publication; do not place credentials or raw archives inside the repository.

## Verification

Before reporting completion, check that every named source has a primary URL, explicit access/implementation state, and caveats; any coverage percentages retain a stated denominator and reconcile; and all claims of actual collection are backed by records rather than portal screenshots. After editing this skill, validate YAML frontmatter, local links, repository-relative program paths, planning totals, and publication-sensitive strings. No dataset, credential, raw log, or generated scan artifact belongs in this skill directory.
