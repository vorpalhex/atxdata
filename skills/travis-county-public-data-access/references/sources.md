# Travis County Source Inventory

Source reconnaissance: 2026-11-01. Repository connector check: 2026-11-02. This is a selective monitoring inventory, not a complete census of county records. Public URLs describe access surfaces, not a verified map of the county's underlying databases. Recheck live systems when using this inventory.

Evidence labels:

- **Sample acquired:** actual records or a file obtained; completeness is not implied.
- **Interface inspected:** source page/search/dashboard reached, but no complete acquisition path verified.
- **Implemented:** a repository collector exists and its stated behavior was exercised.
- **Provisional:** route, automation barrier, or record coverage still needs investigation.

“No connector” below means no matching collector in this repository at the last check. An external tool or another project may exist; inspect before duplicating work.

## 1. Commissioners Court Decisions and Meetings — 15 Planning Points

Primary sources:

- [County Clerk Commissioners Court](https://countyclerk.traviscountytx.gov/departments/commissioners-court): official ownership and link to CivicClerk.
- [CivicClerk public portal](https://traviscotx.portal.civicclerk.com/).
- [County Clerk meeting archives](https://countyclerk.traviscountytx.gov/departments/commissioners-court/cc-archives/): historical coverage requires separate discovery.
- [County Code](https://www.traviscountytx.gov/commissioners-court/county-code): reference chapter PDFs and searchable code. The page explicitly says the online version is not official; Commissioners Court Minutes maintains the official paper record. Only land-development chapters have the described online historical versions.
- [Commissioners Court message board](https://www.traviscountytx.gov/forum): a separate public HTML source, not collected by the current client.

Data: event metadata, agendas, agenda packets, minutes, transcripts, video; separate historical records, policy/code documents, and public message-board material.

Access: medium for CivicClerk API discovery/pagination; trivial for direct PDFs/HTML; historical archive coverage provisional.

State: **implemented + sample acquired** for event metadata and published PDF file types 1 (agenda), 2 (packet), 4 (minutes), and 5 (transcript). `programs/civicclerk-consume/` is the collector; see its README from the repository root. A live event ingestion downloaded four documents, SQLite integrity was checked, and a second process skipped all four using persisted checksums. This demonstrates the ingestion/resume path, not complete current or historical coverage.

Verified API base: `https://traviscotx.api.civicclerk.com/v1/`.

- Events: `Events` with OData-style filtering/pagination and `Events/59` for a sampled event.
- Sample PDF: `Meetings/GetMeetingFileStream(fileId=157,plainText=false)` relative to that API base.
- Do not substitute the previously unsuccessful `Events/GetEventFileStream` route without fresh evidence.

Persistence: `civicclerk.sqlite` under the selected output directory, plus `event-ID/` PDFs. Each output is bound to one tenant. JSON CLI output is not the persistence layer; old JSON manifests are neither consumed nor updated. The client uses the shared Legistar streaming helper, not the Legistar API.

County Code state: **verified manual access workflow + sample acquired** (2026-11-04); see [standalone County Code acquisition](county-code.md). The landing exposed 80 chapter-PDF anchors / 80 unique chapter URLs, plus separate searchable code and Title 30 routes. Two current-reference PDFs were actually acquired and parsed: Chapter 2 (amendments through August 16, 2022, Item 25; 15 pages) and Chapter 464 (through October 21, 2025, Item 45; 64 pages). Source URLs, byte counts, hashes, serial curl commands, private provenance and verified file-level restart are in the procedure. Raw records/headers remain private; no automated client or new persistence stack was added.

County Code historical discovery: the officially linked [enCodePlus archive selector](https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx) exposed 157 non-placeholder option occurrences / 127 unique values, with labels spanning 1995-03-28 to 2026-09-15. Some labels name non-land-development chapters, despite the landing's land-development-only warning. These are interface labels, not proof those historical chapter bodies are available: no archive selection or historical document retrieval was exercised. Online PDFs remain reference copies, not the official paper record; complete history for every chapter is not established.

Remaining: video, richer agenda-item/vote extraction, historical meeting archive discovery/backfill, other County Code chapter bodies and historical-content verification, message-board collection, and ongoing completeness checks. The initial roadmap credits roughly 10 of this bucket's 15 points, solely as a subjective planning placeholder. County Code independent review remains a separate chief-owned gate.

## 2. Budgets and Budget Policy — 10 Planning Points

Primary source: [Planning and Budget current-year documents](https://www.traviscountytx.gov/planning-budget/current-year).

Data: adopted and preliminary budgets, recommendations, guidelines, budget rules, tax-rate documents, and taxpayer-impact statements. The current-year URL is dynamic; discover its actual fiscal-year links rather than hardcoding a filename forever.

Access: trivial anonymous direct PDFs. Parsing a large or scanned document is a separate problem, not an acquisition barrier.

State: **verified access workflow + sample acquired** (2026-11-04), not an automated connector. See [budget acquisition](budgets.md) for the bounded serial curl procedure, manual inventory fields, cooldown/retry rules, atomic promotion, checksum reruns and revision limitations. No new program or SQLite client is introduced.

Live discovery: current-year advertised FY 2027 (tax year 2026), with seven PDF links covering adopted/preliminary budgets, recommendations, guidelines, rules, tax-rate information and taxpayer impact. The [department index](https://www.traviscountytx.gov/planning-budget) linked [prior-year archives](https://www.traviscountytx.gov/planning-budget/archives), including FY 2026 adopted volumes I–IV and earlier holdings. All three HTML bodies were acquired; the index's budget-development and policies-rules links were identified but not fetched. Do not infer complete holdings or publication dates from links/filenames.

Actually archived in private verification storage: FY 2027 adopted budget (29652053 bytes, 511 pages, SHA-256 `61d311a8d65f5e58cfcc266d09f06cc73f6c7ec40e0997eea3c48b114272e2f8`) and taxpayer-impact statement (127112 bytes, one page, SHA-256 `566b43f130ab8395088d566edd6df788a99322a3c385c758b536d4ed4321f5a3`). Both returned PDF bodies and parsed successfully, identifying Travis County/FY 2027; a separate process verified both local hashes without HTTP. Partial/corrupt-copy rejection and overlap-lock behavior were checked. Original bytes, HTML, headers and observation inventory remain outside source. Internal PDF metadata and proposed/adopted wording conflicts are preserved in the workflow's caveats.

Remaining: other document categories and years are discovered, not downloaded/validated. Exhaustive historical coverage, prior revisions, unattended scheduling and automatic remote-change detection remain unimplemented. Manual file-level restart is supported, not byte-range resume. New-client SQLite integrity/typecheck and code-quality metrics are not applicable to this documentation-only access workflow. Independent review completed with PASS for the bounded manual workflow/sample on 2026-11-04; chief acceptance remains pending.

## 3. Actual Spending and Financial Transparency — 15 Planning Points

Primary sources:

- [Financial Transparency Portal](https://financialtransparency.traviscountytx.gov/).
- [Vendor Payment Register](https://financialtransparency.traviscountytx.gov/VPR).
- [Checks page](https://financialtransparency.traviscountytx.gov/Checks), discovered during earlier reconnaissance; revalidate its current contents and extraction path before depending on it.

Data surfaces include vendor payments and financial reporting; the portal also advertises key financial statistics, debt, pensions, economic development, and interactive budgets. Do not equate the list of report surfaces with a verified downloadable schema.

Access: medium, potentially substantial engineering. The Vendor Payment Register wrapper embeds a Power BI Government report hosted by `app.powerbigov.us`.

State: **interface inspected**. No connector. A complete transaction-level export and its pagination/limits have not been verified.

Remaining: inspect the report's actual data/export interfaces, identify authoritative fields and stable keys, prove enumeration, and establish what can be collected without accounts or prohibited workarounds. Reaching the wrapper is not acquiring the register. This is the main gap for comparing approved spending with actual payments.

## 4. Procurement and Contracts — 10 Planning Points

Primary sources:

- [Solicitations search](https://purchasingtransparency.traviscountytx.gov/public/search/solicitations).
- [Contract search](https://ethicspolicy.traviscountytx.gov/public/search/contracts).

Data: solicitation numbers/titles/statuses/publication and closing dates; contract numbers/names/end dates/types/statuses/suppliers/buyers. The interfaces support search criteria and wildcards. Availability of every attachment or document is not established.

Access: medium; interactive search applications, not established bulk feeds.

State: **interface inspected**. No connector; repeatable query enumeration, pagination, and document retrieval are unverified.

Remaining: discover application requests, bound searches, verify all result pages and available attachments, and preserve stable contract/solicitation identities for later links to meetings and payments.

## 5. GIS and Infrastructure Geography — 10 Planning Points

Primary sources:

- [County open-data directory](https://www.traviscountytx.gov/open-data-portal), which links the geographic catalogs.
- [TNR GeoHub](https://tnr-traviscountytx.hub.arcgis.com/).
- [Voter Registration Maps hub](https://voter-registration-maps-traviscountytx.hub.arcgis.com/): affiliated geographic source, not proof that unrestricted individual voter records are available.

Data: geographic layers and maps cataloged through ArcGIS. Inventory each layer's actual topic/schema rather than promising a particular infrastructure dataset from the hub title alone.

Access: medium; ArcGIS catalog discovery, layer queries, export formats, record limits, and pagination.

State: **verified manual access procedure + bounded sample acquired** on 2026-11-04; no automated GIS client. See [TNR GeoHub access](tnr-geohub.md) for the standalone serial curl procedure, request/recovery gates, query arguments and offline checks. Current site item `2eff5d073fca4eeb97d600cda4699e46` supplies nine item-catalog groups; a public Feature Service search returned 17 distinct catalog items with `total=17`, `nextStart=-1`. This is not an inventory of every item type or service layer.

Actual acquisition: catalog item `a8c819373dcf4535b0a7edf0a09b7f04`, Travis County Commissioner Precincts, resolves to the county GIS `Boundaries_and_Jurisdictions/Travis_County_Commissioner_Precincts/FeatureServer`, layer `0`. Two ordered pages of two acquired four polygons (IDs 5–8); before/after count and object-ID queries reconciled exactly. Full field/service/layer metadata and original geometry/SR (`102739`, latest `2277`) were retained privately; only five non-personal attributes were queried from the ten-field schema. `maxRecordCount=2000`, pagination/order supported. A deliberate size-ceiling failure did not promote a body; a full-transfer retry matched the first-page checksum. Offline checksum verification needs no refetch. Item timestamps are preserved but are not feature edit times. The service's separately advertised sharing-item ID was inaccessible; HTTP 200 JSON error detection is required.

Limits: completeness applies to records/geometry of this one layer observation with selected attributes, not all attributes, concurrent-edit snapshot consistency, all catalog layers or historical coverage. No bulk export, automated update tracking, transient-retry/cooldown live branch or voter-hub extraction was verified. Remaining: broader bounded item/service/layer inventory, separately tested export/ID-batch paths where needed, and synchronization. Raw evidence and archives remain outside publishable source.

## 6. Property Taxes and Appraisal — 10 Planning Points

Primary sources:

- [Tax Office bulk property data](https://tax-office.traviscountytx.gov/pages/property.php).
- [TCAD public information and exports](https://traviscad.org/publicinformation).

Data: Tax Office current/prior-year delinquency and tax-roll files, table layouts, rates, and exemptions; TCAD certified/supplemental appraisal exports, JSON exports, layouts, and related reports.

Access: trivial direct bulk CSV/XLSX/ZIP links. The Tax Office says its files refresh each business day. File size does not make acquisition hard, but the current/prior CSV was advertised as 248.17 MB and was deliberately not downloaded.

State: **verified access procedure + full small delinquency file acquired** on 2026-11-04. See [Tax Office bounded bulk access](tax-office-bulk-access.md) for the standalone supervised curl procedure, official file/layout/rates links, safe acquisition limits, validation and restart rules. No new client or SQLite collector was added. The complete 1,686,109-byte delinquency CSV (Last-Modified 2026-11-03) contained 7,285 rows, 31 fields and unique 14-digit text account IDs. Its published 31-field PDF layout was acquired and inspected; the separate current/prior layout was obtained without downloading that roll. SHA-256 checks, a full restart after an incomplete partial, rejection of corrupt content and checksum-based no-request reuse were exercised. These establish one private mutable-file snapshot, not a complete annual archive. TCAD remains **sample acquired in earlier reconnaissance**, with no connector added here.

Remaining: full current/prior rolls, historical snapshots, Excel/ZIP compatibility, rates/exemptions acquisition, cross-snapshot identifier reconciliation and TCAD integration. The delinquency layout still contains 2012 explanatory text; observed last-roll years were 2006–2025, not a guarantee of complete year coverage. Delinquent/current balances are not appraisal values. TCAD is a separate appraisal district, not a Travis County department. Raw owner/account/address records and response headers remain private, outside source.

## 7. Courts and Justice — 10 Planning Points

Primary sources:

- [County open-data directory](https://www.traviscountytx.gov/open-data-portal).
- [Criminal Insights dataset page](https://courtsdata.traviscountytx.gov/CriminalInsights/Dataset).
- [Civil Insights dataset page](https://courtsdata.traviscountytx.gov/CivilInsights/Dataset).
- [District Clerk case information and records](https://www.traviscountytx.gov/district-clerk/case-information-records).
- [Odyssey public records portal](https://odysseyweb.traviscountytx.gov/Portal/), linked by the District Clerk.

Data: published civil/criminal dataset/report surfaces and a separate individual case-record search/document system. Do not treat a justice dashboard as equivalent to full case files.

Access: medium for dataset/report discovery. Individual case searches/documents are a separate, provisional automation target; official/certified physical copies and staff-mediated requests have different costs/rules.

State: **interface inspected**. Direct retrieval reached Civil/Criminal Insights HTML after clean-page extraction failed; no full data export was proved. No connector.

The District Clerk describes free online viewing of public digital records and identifies portal coverage as civil/family from 2006 and criminal from 2008. It separately describes paid physical/certified copies and request routes. Do not describe all court access as paywalled, assume all older records are online, or imply sealed/restricted records are public.

Remaining: inspect actual dataset interfaces and record scopes, prove export completeness, and investigate case-document search access separately. Handle sensitive personal information conservatively.

## 8. Recorded Instruments and Land Records — 10 Planning Points

Primary source: [County Clerk Recording Search + Copies](https://countyclerk.traviscountytx.gov/departments/recording/search-copies-of-records). Follow its current official search links rather than trusting an unrelated commercial mirror.

Data: recording indexes and redacted document images, with record-type/date coverage described by the clerk.

Access: medium–hard/provisional for dependable automation. The clerk says online unofficial copies printed by the user are free. Clerk-supplied email/paper and certified copies, and some historical searches, have fees; these are distinct services.

State: **interface inspected / provisional acquisition**. Earlier browser reconnaissance observed a Cloudflare block on the officially linked TCCSearch surface; this is an environment-specific observation, not proof every client is blocked. No connector or dependable bulk route has been verified.

Remaining: revalidate official vendor links, permitted anonymous search/download behavior, date coverage, and whether bulk access exists. Do not bypass a challenge or purchase copies without authorization.

## 9. Elections — 5 Planning Points

Primary source: [Election Results and Reconciliation Forms](https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms), which links the [Clarity results system](https://results.enr.clarityelections.com/TX/Travis/).

Data: election results, historical result documents, reconciliation forms, and selected audit/certification documents. Availability and format vary by election.

Access: trivial for direct PDFs/files, medium for structured vendor results discovery and enumeration.

State: **interface inspected**; official result/form links identified. No connector. Complete structured results and precinct-level export coverage are unverified.

Remaining: discover election identifiers, acquire final versus unofficial versions, preserve contests/precincts/jurisdictions, and validate totals. Voter-registration data is a different source with its own scope and privacy considerations.

## 10. Campaign Finance — 5 Planning Points

Primary source: [County Clerk campaign-finance information](https://votetravis.gov/candidates-office-holders/campaign-finance).

Source systems linked there:

- [EasyVote](https://traviscountytx.easyvotecampaignfinance.com/) for November 11, 2021 onward.
- [Legacy county filing search](https://www2.traviscountytx.gov/county_clerk/election/finance/finance_search.asp) for January 1, 1997 through November 11, 2021.

Data: campaign contribution/expenditure reports filed by county candidates, officeholders, and committees; scanned filings and current portal records.

Access: medium for search enumeration and PDF acquisition/extraction.

State: **interface inspected**; current/legacy sources identified. No connector. The clerk warns that absence from the website does not establish that a required report was not filed.

Remaining: collect both systems, preserve filer/report/filing-period identity and amendments, and separate source PDF evidence from extracted transactions. Do not mistake security/registration instructions for submitting filings as proof that public reading requires registration.

Personal financial disclosures are a separate record class: the county describes in-office public viewing with a name/address/representation log. Treat that route as hard/staff-mediated, not as another ordinary campaign-finance endpoint.

## Outside the Percentage Model

- [Public Information Records](https://www.traviscountytx.gov/departments/records-request) routes requests for emails, letters, minutes, budgets, reports, statistical data, and other records. Requests for elected officials, courts, and clerks may require separate office routing. A requester interface is not an anonymous downloadable archive.
- Departmental reports, correspondence, unpublished administrative records, and other county programs have not been exhaustively inventoried. No defensible percentage of these holdings is known.
- Request-only does not mean everything requested must be released; exemptions/redactions and office-specific processes may apply. Never submit a request or disclose the operator's identity without authorization.
- Other municipalities, school districts, appraisal districts, regional bodies, and state/federal agencies are separate institutions even when their data concerns Travis County geographically.

## Updating an Entry

For each addition, preserve the primary source and add the verification date, access grade/reason, evidence level, repository-relative collector path, supported scope, tested acquisition/resume behavior, and remaining gaps. Keep source availability, implementation, and actual archival coverage separate. Update planning totals only as explicitly labeled estimates; never promote a tested sample to a completeness claim.
