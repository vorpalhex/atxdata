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
- [County Clerk meeting archives](https://countyclerk.traviscountytx.gov/departments/commissioners-court/cc-archives/): static historical minutes; see [bounded historical minutes access](meeting-archives.md).
- [County Code](https://www.traviscountytx.gov/commissioners-court/county-code): reference chapter PDFs and searchable code. The page explicitly says the online version is not official; Commissioners Court Minutes maintains the official paper record. Only land-development chapters have the described online historical versions.
- [Commissioners Court message board](https://www.traviscountytx.gov/forum): separate public Kunena HTML discussion; [bounded manual access](court-message-board.md) verified, not collected by CivicClerk.

Data: event metadata, agendas, agenda packets, minutes, transcripts, video; separate historical records, policy/code documents, and public message-board material.

Access: medium for CivicClerk API discovery/pagination; trivial for direct PDFs/HTML, including the sampled historical minutes. Broader historical availability remains provisional.

Historical minutes state: **verified manual access procedure + sample acquired** (2026-11-04); see [historical minutes access](meeting-archives.md). The official archive HTML exposed 988 PDF anchors / 987 distinct URLs in 1996–2010 directories, including a duplicate and date-label/filename anomalies; counts are links, not meetings or successful document fetches. Its “2011 to Present” legacy CivicClerk link returned HTTP 301 to the modern portal. Advertised coverage is adjacent, not proof of complete coverage or zero cross-system overlap; pre-1996, the 2010/2011 boundary and 2011–2020 availability are unverified. One January 5, 2010 voting-session minutes PDF was actually acquired (119994 bytes, ten pages, SHA-256 `3cdb0b3a0f7e11e90ac493dc56c913516c1c3e4c38077c4d5ce6918a873c4269`). Poppler parsing and rendered page 1 confirmed the role/body/title and an opening-sentence date conflict. qpdf exited 3 with linearization warnings, not a clean pass; original bytes remain intact. Private provenance retains the source chain, distinct meeting/publication/metadata dates, publisher noindex/noarchive/nosnippet header and document hash. Offline checksum rerun, corrupt/partial rejection, lock collision and no-clobber checks were exercised; no interrupted remote retry or complete backfill was tested. This is not a new collector; code-only metrics/SQLite gates are N/A and independent review remains chief-owned.

State: **implemented + bounded sample reverified** (2026-11-04). `programs/civicclerk-consume/` supports event metadata and published PDF types 1 (agenda), 2 (packet), 4 (minutes), and 5 (transcript); see [standalone CivicClerk access](civicclerk.md) and the program README from the repository root. Fresh acquisition was limited to event 59 (January 5, 2021) and TWO PDFs: agenda file 157 (263461 bytes, 5 pages, SHA-256 `8b13860219cd0b6554fdbac68ff655beb4c4fd50ba96472f0accc6b95b9eb31b`) and minutes file 3733 (138403 bytes, 8 pages, SHA-256 `1e19ce8abfb6a039fa19a954eb55ad149c6087d866d68c152dd115a677ae62c1`). Both parsed and matched the Court/date identity; agenda qpdf exited 3 with linearization/hint-table warnings, minutes exited 0. Combined size was 401864 bytes. The day listing reconciled one unique event to count 1 with no next link. Actual client trace peak was 1 with gaps above 2.2 seconds; offline reruns skipped both with zero HTTP and SQLite integrity/foreign-key checks passed. Packet/transcript were discovered, not newly acquired. Earlier four-PDF acquisition is not this observation or proof of complete historical coverage.

Verified API base: `https://traviscotx.api.civicclerk.com/v1/`.

- Events: `Events` with OData-style filtering/pagination and `Events/59` for a sampled event.
- Sample PDF: `Meetings/GetMeetingFileStream(fileId=157,plainText=false)` relative to that API base.
- Do not substitute the previously unsuccessful `Events/GetEventFileStream` route without fresh evidence.

Persistence: `civicclerk.sqlite` under the selected private absolute archive root, plus `event-ID/` PDFs. Each archive is tenant-bound and ingestion-locked before discovery. SQLite stores normalized event versions, download checksum history and run status; JSON stdout is not persistence and old JSON manifests remain untouched. The client reuses the Legistar streaming helper, not its API. Manual redirects/zero retries are the defaults; full-body pacing is two seconds with server cooldowns honored even on success. Signature/byte checks, no-clobber promotion, ancestor/file/SQLite symlink refusal, actual process-interruption recovery and zero-request offline reuse were tested. Corrupt or uncheckpointed existing artifacts require explicit operator investigation/removal, not silent replacement. Process-crash locks and unfinished runs are not automatically reclaimed.

County Code state: **verified manual access workflow + sample acquired** (2026-11-04); see [standalone County Code acquisition](county-code.md). The landing exposed 80 chapter-PDF anchors / 80 unique chapter URLs, plus separate searchable code and Title 30 routes. Two current-reference PDFs were actually acquired and parsed: Chapter 2 (amendments through August 16, 2022, Item 25; 15 pages) and Chapter 464 (through October 21, 2025, Item 45; 64 pages). Source URLs, byte counts, hashes, serial curl commands, private provenance and verified file-level restart are in the procedure. Raw records/headers remain private; no automated client or new persistence stack was added.

County Code historical discovery: the officially linked [enCodePlus archive selector](https://online.encodeplus.com/regs/traviscounty-tx/archivedialog.aspx) exposed 157 non-placeholder option occurrences / 127 unique values, with labels spanning 1995-03-28 to 2026-09-15. Some labels name non-land-development chapters, despite the landing's land-development-only warning. These are interface labels, not proof those historical chapter bodies are available: no archive selection or historical document retrieval was exercised. Online PDFs remain reference copies, not the official paper record; complete history for every chapter is not established.

Message-board state: **verified manual access workflow + sample acquired** (2026-11-04); see [standalone message-board access](court-message-board.md). Anonymous serial full-body curl acquired the index, Purchasing Office category and topic 302. The category advertised one reply; two unique post IDs (479/482) reconciled root plus reply, with only page 1 and disabled next/end controls. Exact timestamps and forum-versus-quoted authorship remain in private provenance. Selected-topic attachment metadata was absent; no attachment downloaded. Discussion and quoted vote claims are not independent proof of adopted Court action. Local checksum reruns and offline-copy recovery checks were verified; complete forum history, multi-page enumeration, attachment retrieval and remote edit tracking remain unverified. No new collector/persistence stack was added; independent review remains chief-owned.

CivicClerk richer metadata: the one actual event response advertised agenda ID 59, agenda/media presence and on-demand media with a nonempty stream field, but no item/vote collections. No media was requested and no item/vote route was guessed; structured items/votes, playable video and broader API availability remain unverified/unimplemented. The normalizer does not retain these optional media fields; raw evidence stays private. Independent review is chief-owned.

Remaining: video, richer agenda-item/vote extraction, broader historical meeting availability/identity reconciliation and backfill beyond the one verified minutes sample, other County Code chapter bodies and historical-content verification, broader message-board/attachment collection, and ongoing completeness checks. The initial roadmap credits roughly 10 of this bucket's 15 points, solely as a subjective planning placeholder. County Code independent review remains a separate chief-owned gate.

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

State: **supervised fiscal-year payment export acquired and sample reconciled** through the [normal-browser workflow](financial-transparency.md). The portal says VPR and VPD have merged into Vendor Payment Details; its current tile led to VPR. One original FY2027 CSV was downloaded (3,211,435 bytes; SHA-256 `2e2ec55d399ba381e3564f78d380c7d65359b3b82ce97402e6c5083b3b14f8c0`). CSV parsing found 19,459 data records: 19,458 with the 13 header fields and one malformed 14-field record retained unchanged. The width-valid records span October 1–November 4, 2026. One selected payment's two rows reconcile across all twelve UI data fields and a zero net amount. The fiscal-year file is not limited to the table's payment filter, and no whole-year/completeness or clean-source claim is made. The former live-query client was replaced by a reviewed [offline Bun/SQLite importer](../../../programs/financial-transparency-consume/README.md): 19,458 accepted rows and one quarantined width rejection, immutable-copy/hash provenance, duplicate-file reuse and full local verification. Browser acquisition remains separate; no Power BI query/transport replay is implemented.

Remaining: keep the source-format anomaly explicit, verify additional years/Checks/report surfaces separately if needed, and establish cross-snapshot identities before any financial merging. Browser access and offline import received independent reviews and were exercised on actual retained source bytes. This is actual register acquisition and local ingestion, not just the report wrapper; full historical enumeration remains unverified.

## 4. Procurement and Contracts — 10 Planning Points

Primary sources:

- [Solicitations search](https://purchasingtransparency.traviscountytx.gov/public/search/solicitations).
- [Contract search](https://ethicspolicy.traviscountytx.gov/public/search/contracts).

Data: solicitation numbers/titles/statuses/publication and closing dates; contract numbers/names/end dates/types/statuses/suppliers/buyers. The interfaces support search criteria and wildcards. Availability of every attachment or document is not established.

Access: medium; interactive search applications, not established bulk feeds.

State: **bounded contract metadata access verified** through normal agent-browser interaction; see [supervised Contract Search procedure](contracts.md). Two independent browser sessions reproduced one seven-field contract row and reconciled `1-1 of 1` with disabled pagination. Normal browser-managed concurrency is allowed; no standalone API client is implemented. The sampled row has no detail/attachment controls, and no original contract document was acquired. Solicitation metadata/detail access is also verified through the [supervised solicitation workflow](solicitations.md): two fresh sessions reproduced one five-field `275-CO` row with `1-1 of 1` and disabled pagination. The county detail exposed a published BidNet link that reached SSO login; no registration/login was attempted and no original attachment acquired. Full solicitation history and vendor-document access remain unimplemented.

Remaining: separately verify other bounded filters, multi-page enumeration and any actually exposed public attachments; preserve source identities for later links to meetings/payments. Do not infer complete procurement coverage or universal document absence from the single sample.

## 5. GIS and Infrastructure Geography — 10 Planning Points

Primary sources:

- [County open-data directory](https://www.traviscountytx.gov/open-data-portal), which links the geographic catalogs.
- [TNR GeoHub](https://tnr-traviscountytx.hub.arcgis.com/).
- [Voter Registration Maps hub](https://voter-registration-maps-traviscountytx.hub.arcgis.com/): affiliated geographic source, not proof that unrestricted individual voter records are available.

Data: geographic layers and maps cataloged through ArcGIS. Inventory each layer's actual topic/schema rather than promising a particular infrastructure dataset from the hub title alone.

Access: medium; ArcGIS catalog discovery, layer queries, export formats, record limits, and pagination.

State: **verified manual access procedure + bounded sample acquired** on 2026-11-04; no automated GIS client. See [TNR GeoHub access](tnr-geohub.md) for the standalone serial curl procedure, request/recovery gates, query arguments and offline checks. Current site item `2eff5d073fca4eeb97d600cda4699e46` supplies nine item-catalog groups; a public Feature Service search returned 17 distinct catalog items with `total=17`, `nextStart=-1`. This is not an inventory of every item type or service layer.

Actual acquisition: catalog item `a8c819373dcf4535b0a7edf0a09b7f04`, Travis County Commissioner Precincts, resolves to the county GIS `Boundaries_and_Jurisdictions/Travis_County_Commissioner_Precincts/FeatureServer`, layer `0`. Two ordered pages of two acquired four polygons (IDs 5–8); before/after count and object-ID queries reconciled exactly. Full field/service/layer metadata and original geometry/SR (`102739`, latest `2277`) were retained privately; only five non-personal attributes were queried from the ten-field schema. `maxRecordCount=2000`, pagination/order supported. A deliberate size-ceiling failure did not promote a body; a full-transfer retry matched the first-page checksum. Offline checksum verification needs no refetch. Item timestamps are preserved but are not feature edit times. The service's separately advertised sharing-item ID was inaccessible; HTTP 200 JSON error detection is required.

Limits: completeness applies to records/geometry of this one TNR layer observation with selected attributes, not all attributes, concurrent-edit snapshot consistency, all catalog layers or historical coverage. No TNR bulk export, automated update tracking or transient-retry/cooldown live branch was verified. Voter-hub access was separately verified below; TNR evidence is not its proof. Remaining: broader bounded item/service/layer inventory, separately tested export/ID-batch paths where needed, and synchronization. Raw evidence and archives remain outside publishable source.

Voter hub state: **verified manual access procedure + one published layer acquired** (2026-11-04); see [standalone Voter Registration Maps access](voter-maps.md). The exact voter hub's site item `7900dcb8fa674dcf93bcbbd49c29e0db` identifies catalog group `16f087181c9b4ccb9e42ad3fb7c78c3e`. One public search returned 16 unique items, `total=16`, `nextStart=-1`; this includes pages, maps and services, not 16 acquired layers. Its catalog-linked GIS Maps and Downloads page explicitly publishes Election Precincts shapefile item `bc55843a0d9a4044a9ba46952007c6fc`.

Actual voter-hub acquisition: one 656459-byte ZIP, SHA-256 `108837b38a9f913740577b5ab0784c40022df20ea0e00930b56ba0b9bb145c41`, containing one complete published geographic layer with six original components. SHP/SHX/DBF counts and unique nonempty Precinct identities reconcile at 308; all 308 rings / 65699 coordinate pairs passed structural checks. Original native StatePlane Texas Central PRJ (US survey feet), district fields, schema, publisher/edit-date metadata and item created/modified timestamps were preserved privately. Before/after bulk metadata was unchanged. A corresponding live service count was also 308, but no live feature IDs/geometry were compared: matching counts do not establish version/content equality. A capped transfer failed without promotion and a full retry reproduced the hash; offline checksum rerun passed. No individual voter, address-point, property-owner or survey feature records were requested. This is manual bulk-file access, not a new client, all-layer backfill, historical archive or election-results collector; other linked maps/services are discovery-only.

## 6. Property Taxes and Appraisal — 10 Planning Points

Primary sources:

- [Tax Office bulk property data](https://tax-office.traviscountytx.gov/pages/property.php).
- [TCAD public information and exports](https://traviscad.org/publicinformation).

Data: Tax Office current/prior-year delinquency and tax-roll files, table layouts, rates, and exemptions; TCAD certified/supplemental appraisal exports, JSON exports, layouts, and related reports.

Access: trivial direct bulk CSV/XLSX/ZIP links. The Tax Office says its files refresh each business day. File size does not make acquisition hard, but the current/prior CSV was advertised as 248.17 MB and was deliberately not downloaded.

State: **verified access procedure + full small delinquency file acquired** on 2026-11-04. See [Tax Office bounded bulk access](tax-office-bulk-access.md) for the standalone supervised curl procedure, official file/layout/rates links, safe acquisition limits, validation and restart rules. No new client or SQLite collector was added. The complete 1,686,109-byte delinquency CSV (Last-Modified 2026-11-03) contained 7,285 rows, 31 fields and unique 14-digit text account IDs. Its published 31-field PDF layout was acquired and inspected; the separate current/prior layout was obtained without downloading that roll. SHA-256 checks, a full restart after an incomplete partial, rejection of corrupt content and checksum-based no-request reuse were exercised. These establish one private mutable-file snapshot, not a complete annual archive. TCAD now has a separate [bounded export procedure](tcad-exports.md), verified on 2026-11-04. Expanded authorization permitted ONE complete certified appraisal ZIP (557228168 bytes; SHA-256 `62d0d1cd22b03f31db8d3986160eb181c5d00044df98a303fce9e17a44e9aa02`). All 21 members passed streamed CRC/length checks; 17989848588 expanded bytes were processed without full extraction. The first 25 `PROP.TXT` records matched the retained 493-field layout and positive appraised/assessed values, preserving year `02026`, supplement `000000000000` and property/account keys as strings. This is bounded row-schema validation, not all-row quality or unique-property enumeration. Export-header version-like strings `8.1.33.23` and `8.0.0.33` are retained separately from layout filename `Legacy8.0.33`. Earlier evidence remains one complete 287774-byte waterfront ancillary CSV (5372 rows, four fields) and the 248399-byte layout ZIP; the CSV uses its own header schema. Supplemental/JSON bodies remain HEAD-only. Checkpoint/attempt-aware rejection, header-symlink rejection, checksums, no-request reuse and interrupted-promotion recovery are documented and exercised. This is a supervised access skill, not an unattended client or historical archive. The standalone verification summary preserves both initial spacing and unintended-repeat-GET incidents.

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

State: **Criminal Insights supervised browser access and one official fallback report verified**; see the [workflow and source distinctions](criminal-insights.md). The dashboard was filtered to Travis, calendar 2025, January, County division. Its previously denied Qlik CSV export was not retried. The official OCA public report builder separately delivered an original two-page Travis misdemeanor activity PDF for January 1–31, 2025 (83,831 bytes; SHA-256 `54757a4968a26e604649f7face6d7520bfe560a965e8ef587a316c08bbc041be`). Structure, readable text, both rendered pages and report identity/counts were checked. Three Added Type percentages reconcile narrowly with the filtered dashboard; no identical full-dataset/version or history claim is made. Civil Insights now has a verified [supervised aggregate view plus official OCA report fallback](civil-insights.md): calendar 2025 / JAN / CIVIL showed 923 Cases Added. One original ten-page OCA District Court Activity Detail bundle for Travis, January 1–31, 2025 was acquired (111,832 bytes; SHA-256 `391747602e17efba6477b1f0aa16bd2a3277ca3e9b42094ed3bad2d37d11d02c`). All physical-page headers/numbering were text-validated; civil-section page 5 totals 881 new + 19 reactivated + 23 other reconcile narrowly with 923 and two visible chart shares. The bundle contains other court sections, not separately queried or reconciled. No identical model/revision/history claim or standalone client; Odyssey remains separate.

The District Clerk describes free online viewing of public digital records and identifies portal coverage as civil/family from 2006 and criminal from 2008. It separately describes paid physical/certified copies and request routes. Do not describe all court access as paywalled, assume all older records are online, or imply sealed/restricted records are public. The [Odyssey browser investigation](odyssey.md) revalidated that official link and reached Smart Search, which visibly showed an unchecked reCAPTCHA. No challenge interaction or search submission was attempted; zero case records/documents acquired. Odyssey remains blocked for agent acquisition pending a permitted human-assisted flow, not proven universally unavailable or registration-only.

Remaining: Criminal Insights full export remains restricted; full Civil Insights export/history and broader OCA report/measure coverage are unverified. Odyssey case-document acquisition remains blocked at the observed challenge. Handle sensitive personal information conservatively.

## 8. Recorded Instruments and Land Records — 10 Planning Points

Primary source: [County Clerk Recording Search + Copies](https://countyclerk.traviscountytx.gov/departments/recording/search-copies-of-records). Follow its current official search links rather than trusting an unrelated commercial mirror.

Data: recording indexes and redacted document images, with record-type/date coverage described by the clerk.

Access: medium–hard/provisional for dependable automation. The clerk says online unofficial copies printed by the user are free. Clerk-supplied email/paper and certified copies, and some historical searches, have fees; these are distinct services.

State: **operator-confirmed live browser workflow; agent acquisition pending**. The operator successfully searched/viewed through their normal Brave session. A separate fresh managed-Chrome session hit an explicit Cloudflare block; that environment-specific denial does not negate operator access. Use the [supervised live-browser skill](recording-search.md), normal widget interactions and an authorized attachment to the working tab when available. No reconstructed POST client or bulk feed is implemented.

Remaining: verify live automation attachment without restarting or copying the operator's profile/cookies, then tie one selected instrument to a complete free image/copy set with page/content/hash checks. No agent-retained original image acquisition or complete date/history coverage is claimed. Paid/certified copies, registration and challenge bypass require separate authority.

## 9. Elections — 5 Planning Points

Primary source: [Election Results and Reconciliation Forms](https://votetravis.gov/current-election-information/election-results-and-reconciliation-forms), which links the [Clarity results system](https://results.enr.clarityelections.com/TX/Travis/).

Data: election results, historical result documents, reconciliation forms, and selected audit/certification documents. Availability and format vary by election.

Access: trivial for direct PDFs/files, medium for structured vendor results discovery and enumeration.

State: **sample acquired / verified manual publication access**, 2026-11-04. The [standalone election document procedure](election-documents.md) follows the canonical trailing-slash VoteTravis page, whose historical sections link direct PDFs alongside newer reconciliation forms. June 11, 2022 local runoff official cumulative results (2 pages, 101616 bytes) and official reconciliation (1 page, 24807 bytes) were acquired anonymously, parsed and visually checked. The selected section contained three anchors / three unique URLs; its precinct PDF was not fetched. The cumulative text layer is corrupted, so rendered pages supplied semantic verification. Preserve differing page/body election labels, Leander/Manor contest jurisdictions, body report/attestation dates, unknown publication dates and version hashes. That earlier publication-only observation fetched the Clarity landing but did not extract structured results; the separate bounded Clarity observation below extends this. No complete export coverage or automated election connector is claimed.

Remaining: other elections, selected precinct results, audit/certification PDFs, exhaustive historical inventory and remote revision history. Current preliminary forms are explicitly unofficial: do not infer finality from filenames. The two official 2022 publications do not establish complete coverage or certification of every contest. Voter-registration data is a separate, excluded source. The separately verified [Voter Registration Maps geographic workflow](voter-maps.md) acquired one published precinct layer (section 5), not election results or individual voter-registration records. Person-level voter data remains outside authorization.

Clarity state (2026-11-04): **verified supervised access skill + one structured snapshot acquired**, not an automated collector. See [standalone Clarity results access](clarity-results.md). The official link's actual frontend exposed `elections.json` (17 distinct EIDs, no pagination field); one selected election `125662` (December 13, 2025), version `367565`, yielded a 2,053-byte Detail XML ZIP, two contests, four choices, 31 turnout precinct labels and 310 choice/vote-type/precinct rows. County/State IDs `1239`/`9`, exact string contest/choice/precinct identities, XML and website timestamps, settings, summary and precinct-detail bodies are retained privately. XML nested sums and JSON totals reconcile. Numeric municipal IDs were not supplied/verified; contest jurisdiction labels are preserved rather than invented IDs.

Clarity verification limits: the published header says “Official Results” and “7/7 Vote Centers Reporting”, but final/canvass flags are false, contest reported counts zero, and precinct status includes partial/nonreported values; preserve all conflicting states. The officially linked GR25 audit PDF was acquired and rendered pages inspected, including its scope on page 1. Audit-versus-XML population, cutoff and version equivalence is not established: the audit completed December 17 and was dated December 18, while the XML reports December 19. Its own selected electronic-versus-hand tally discrepancy columns are zero. A selected Leander early-voting aggregate equality is not contest-wide validation, and no election-error inference follows from unjoined cross-document values. The audit page-4 heading/footer date inconsistency is preserved as document metadata, not an election-result error. No claim of full independent total agreement/certification. Checksum-only rerun, 17 offline command/recovery checks, live size-ceiling refusal and full restart with matching hash were exercised; before/after version tokens agreed. Other export formats, elections/version history, municipal-ID resolution, fully rendered live interface and any future population/version-comparable audit comparison remain incomplete. Raw evidence remains outside source; independent review is chief-owned.

## 10. Campaign Finance — 5 Planning Points

Primary source: [County Clerk campaign-finance information](https://votetravis.gov/candidates-office-holders/campaign-finance).

Source systems linked there:

- [EasyVote](https://traviscountytx.easyvotecampaignfinance.com/) for November 11, 2021 onward.
- [Legacy county filing search](https://www2.traviscountytx.gov/county_clerk/election/finance/finance_search.asp) for January 1, 1997 through November 11, 2021.

Data: campaign contribution/expenditure reports filed by county candidates, officeholders, and committees; scanned filings and current portal records.

Access: medium for search enumeration and PDF acquisition/extraction.

State: **bounded EasyVote filing acquisition verified** through the [supervised public-browser workflow](easyvote-finance.md). One source-delivered COH PDF was acquired without login, validated as eight pages (UD declaration plus seven declared report pages), and visually bound to its filer, July 15 report and January–June 2026 period. Earlier anonymous-bootstrap HTTP 500 was a historical service failure; normal browser access now works. No standalone API client, all-filer census, amendment/history completeness or structured transaction extraction is claimed. Legacy collection is intentionally **WILL NOT IMPLEMENT**; see the [small legacy-system note](legacy-finance.md). All attempted published PDF links returned 404, including ten links spread across source-listed filing dates in 1997–2021 (0/10 availability yield). Do not resume legacy work without explicit operator authorization.

Remaining modern scope only: extend bounded EasyVote coverage, preserve filer/report/filing-period identity and amendments, and keep source PDF evidence distinct from extracted transactions. Website absence never proves non-filing. Registration instructions for submitting filings are not evidence public viewing requires an account.

Personal financial disclosures are a separate record class: the county describes in-office public viewing with a name/address/representation log. Treat that route as hard/staff-mediated, not as another ordinary campaign-finance endpoint.

## Outside the Percentage Model

- [Public Information Records](https://www.traviscountytx.gov/departments/records-request) routes requests for emails, letters, minutes, budgets, reports, statistical data, and other records. Requests for elected officials, courts, and clerks may require separate office routing. A requester interface is not an anonymous downloadable archive.
- Departmental reports, correspondence, unpublished administrative records, and other county programs have not been exhaustively inventoried. No defensible percentage of these holdings is known.
- Request-only does not mean everything requested must be released; exemptions/redactions and office-specific processes may apply. Never submit a request or disclose the operator's identity without authorization.
- Other municipalities, school districts, appraisal districts, regional bodies, and state/federal agencies are separate institutions even when their data concerns Travis County geographically.

## Updating an Entry

For each addition, preserve the primary source and add the verification date, access grade/reason, evidence level, repository-relative collector path, supported scope, tested acquisition/resume behavior, and remaining gaps. Keep source availability, implementation, and actual archival coverage separate. Update planning totals only as explicitly labeled estimates; never promote a tested sample to a completeness claim.
