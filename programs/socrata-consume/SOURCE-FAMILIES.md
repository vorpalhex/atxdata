# Austin source families

Use the same collector and designated private archive for these public tabular
sources. This is an acquisition guide, not a second downloader, a dataset
allowlist, a joined civic database, or a claim that every listed asset has been
archived. Inspect current catalog membership and schema before collection:

    bun src/cli.ts inspect 84ih-p28j --archive <private-archive> --json
    bun src/cli.ts inspect 3ebq-e9iz --archive <private-archive> --json

Supply an explicit positive `--max-rows` and, when appropriate, an exact SoQL
`--where` selection using published fields and values. The collector counts that
selection before fetching rows and refuses an over-budget prefix. Keep the
original asset, source IDs, raw row JSON, schema, query and observation version;
do not infer a relationship from matching labels or coerce identifiers to numbers.

## Spending, contracts and purchase orders

| Published asset                                                       | ID          | Interpretation boundary                                                                  |
| --------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| Austin Finance Online eCheckbook                                      | `8c6z-qnmj` | Expenditure observations, not the entire City accounting ledger.                         |
| Contracts                                                             | `84ih-p28j` | Contract catalog rows, not a complete historical archive of executed contract documents. |
| Purchase Order Quantity Price detail for Commodity/Goods procurements | `3ebq-e9iz` | Purchase-order commodity lines, not payment transactions or an invoice ledger.           |

Official catalog links:

- https://datahub.austintexas.gov/d/8c6z-qnmj
- https://datahub.austintexas.gov/d/84ih-p28j
- https://datahub.austintexas.gov/d/3ebq-e9iz

The City's eCheckbook explanation excludes certain Austin Energy competitive
transactions under Texas Government Code Section 552.133 and Council Resolution
20051201-002. Some line amounts therefore do not represent a full check amount.
The collector retains the publisher's metadata; it cannot recover excluded rows.
See https://www.austintexas.gov/financial-services/financial-transparency.

The Contracts publisher states that contracts are visible only while active, so
this catalog is not an archive of expired contracts. Contract fields such as
`doc_cd`, `doc_dept_cd`, `doc_id`, `doc_vers_no`,
`doc_vend_ln_no` and `row_key` retain distinct identities. The purchase-order
source publishes `purchase_order`, `master_agreement`, quantities, units and
prices at its own grain. Preserve those fields without treating every contract,
order, vendor or version as one payment. This collector does not assert a
cross-table join key or deduplicate business records merely because names match.

## Campaign finance

Use separate observations for the related published tables; never concatenate
them into one additive money table:

| Published table              | ID          |
| ---------------------------- | ----------- |
| Transaction Detail           | `g4yx-aw9r` |
| Contributions                | `3kfv-biw6` |
| Expenditures                 | `gd3e-xut2` |
| Report Detail                | `b2pc-2s8n` |
| Credits                      | `xhtw-mkpj` |
| Pre-Election Summary         | `xbpn-n65g` |
| Loans                        | `teb3-cwz9` |
| Travel Outside of Texas      | `ybu9-692h` |
| Direct Campaign Expenditures | `8p2b-ewep` |
| Committee Purpose            | `u3cd-iecr` |

The Clerk also publishes a Covered Transfers link, `5uaf-hku2`.[1] A current
catalog-backed native inspection refused it as absent from the Austin dataset
catalog. Its acquisition is unresolved; do not substitute another asset or treat
an old published link as current catalog membership.

Inspect each asset through the current catalog. The published campaign data model
links transaction `report_id` to report `report_id` and gives travel/direct-campaign
records their own transaction/report relationships.[2] Preserve actual identifiers,
`cor_flag` or `correction` fields and original observations without filtering away
amendments, guessing identifier concatenations, or summing report totals together
with their underlying transactions. Current schema inspection is required: the
published dictionary is dated 2016 and does not guarantee unchanged field labels.[3]

The Clerk describes this as self-reported, unverified data from 2016 onward.[1] Its
current notice says contributor street addresses are redacted from online datasets
following the 2023 law change.[1] Do not reconstruct those addresses from older
copies or other records. Original filings remain a separate document surface.
Structured records do not establish that every historical original filing survives
or has been collected. Summary, loan, credit and transaction amounts are not
additive contributions merely because they have amount fields.

Published model and dictionary:

- https://services.austintexas.gov/edims/document.cfm?id=301923
- https://services.austintexas.gov/edims/document.cfm?id=247730

Official source: https://services.austintexas.gov/cityclerk/cfdi/index.cfm.

## Lobbyist registrations and activity

| Published table/view                              | ID          |
| ------------------------------------------------- | ----------- |
| Master List of Lobbyists (Oracle View)            | `96z6-upac` |
| Clients                                           | `7ena-g23u` |
| Registrants                                       | `58ix-34ma` |
| Reports                                           | `aahu-djdd` |
| Expenditures                                      | `m5xf-v2bw` |
| Real Property                                     | `ums6-jers` |
| Municipal Questions                               | `9uru-cmtw` |
| Report Types                                      | `4zpf-72n3` |
| Due Dates                                         | `nydq-gwfg` |
| Subject Matter List                               | `7jrx-icwh` |
| Employees                                         | `u6yt-em2w` |
| City Officials                                    | `tnne-6nva` |
| Municipal Question Subject Matter Key-Value Pairs | `tajf-gz53` |

The official Clerk page additionally links "Lobbyist Reports", `f5dv-uwts`.[4]
That linked asset is distinct from raw Reports `aahu-djdd`. It has not yet passed
native inspection in this workstream, so do not silently replace the raw table,
assert an unverified view title or claim that both representations were acquired.

The master view is not a substitute for every activity or relationship table.
The published model identifies registrant and report keys separately, with
report-linked clients, expenditures, employees, municipal questions, property
and subject-matter relationships.[5] Keep published supersession/activity fields
when present; the 2018 internal-model diagram does not prove that every internal
field exists in the current public tables. Inspect each published schema and
preserve string keys rather than joining people by names or concatenating
lookup rows into additive spending records. Collection began in July 2017.[4]
A contact, registration, question or expenditure does not prove improper
influence. Departmental visitor logs are separate sources, not implicitly part
of a lobbyist report.

Published model: https://services.austintexas.gov/edims/document.cfm?id=293053.

Official source: https://services.austintexas.gov/cityclerk/lobbyist/index.cfm.

## Permitting, zoning and enforcement registrations

These are distinct published datasets, not a combined property or case-history
ledger:

| Published dataset             | ID          | Observed selector field |
| ----------------------------- | ----------- | ----------------------- |
| Issued Construction Permits   | `3syk-w9eu` | `permit_number` (text)  |
| Zoning By Address             | `nbzi-qabm` | `place_id` (number)     |
| Repeat Offender Registrations | `86z9-i27i` | `foldernumber` (text)   |

The permits publisher describes issued building, electrical, mechanical, plumbing
and driveway/sidewalk permits, with details such as issue/expiration dates, work,
valuation and units.[6] Issuance is not the same event as an application,
inspection, zoning decision or enforcement action. Collect these at their own
grain; a permit row is not an attached plan or complete project history.

The zoning publisher explicitly says not to use this table to make zoning
determinations: it can be out of date and omits overlays and multiple-zoning
situations.[7] It covers addresses within City limits and provides `place_id` for
linking to the address GIS layer.[7] That is not a universal parcel or cross-source
case key. The publisher points to PropertyProfile for zoning inquiries; this
collector does not turn the table into an authoritative zoning decision or
establish acquisition of the separate mapping application's underlying services.[7]

Repeat Offender Registrations lists properties in the Development Services
program; its status indicates whether a property is currently actively
registered.[8] Preserve inactive records and source status rather than treating
all rows as current violations or labeling people as offenders. The publisher
calls these data informational, potentially different from official department
records, and continuously updated.[8] Registration rows do not establish complete
inspection/enforcement case histories; AB+C records and attachments are separate.

Inspect the current schema before constructing predicates. In the observed schemas,
`permit_number` and `foldernumber` are text while `place_id` is numeric; preserve
original identifiers and numeric lexemes rather than coercing every key into the
same type.[6][7][8] Do not infer relationships by matching addresses or names. Bounded
related-catalog discovery identifies leads, not an exhaustive enforcement inventory.

## Council votes and departmental operations

- City of Austin Council Voting Record: `3c89-i35a`. The retained publisher
  metadata says January 6, 2023 onward; the Clerk page says new records are added
  after each meeting's minutes are approved. That is an approval-dependent lag,
  not a fixed daily or numerical deadline. The approved minutes are the official
  record. Metadata also warns of non-daily publication, change without notice
  and possible 2026 data-warehouse migration interruptions. Preserve `vote_id`,
  `item_id`, meeting date/type/item number, member name/title/district, vote cast
  and action taken as separate source fields. Here `voter_name` means a voting
  Council official, not an individual registered voter. These keys are not
  automatically Legistar meeting, matter or attachment IDs; no cross-source
  join or pre-2023 roll-call completeness is asserted. See
  https://www.austintexas.gov/clerk/council-voting-history.
- Departmental 311, signs, markings and work-order datasets are distinct streams.
  A transportation 311 subset does not establish whole-city service-request
  coverage or identify all callers.

The previously identified `xwdj-i9he` asset was absent from the current catalog
response during this discovery even though an earlier metadata observation
existed. Its status is unresolved; do not repair the token or silently substitute
another 311 asset. A successful metadata request alone does not establish current
catalog membership or permit this collector's source validation to be bypassed.

Bounded keyword searches are discovery observations, not an exhaustive inventory.
Dataset-specific row acquisition, date coverage, missing records and semantic
interpretation must be established independently. Keep public personal/contact
fields private in the acquisition archive; do not publish fixture rows or enrich
people to demonstrate collection.

## Operational and departmental datasets

These assets have distinct grains and limits. Choose an explicit positive row
budget and a source-field predicate after current schema inspection; a bounded
selection is not whole history. The observed selectors below are not proven
unique, stable, populated, or join keys. Preserve original observations without
publishing example rows or personal details. Deduplicate cross-category discovery
only by identical dataset ID; do not merge ambiguous parents or views.

| Dataset                                                         | ID          | Observed selector           | Grain and limit                                                                                                                                                                             |
| --------------------------------------------------------------- | ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 311 Service Requests - Austin Transportation and Public Works   | `38mr-dwji` | `service_request_sr_number` | Department-assigned requests from October 2021; not whole-city 311 or a proven replacement for the unresolved older asset.[9]                                                               |
| Crime Reports                                                   | `fdj4-gpfu` | `incident_report_number`    | Report-written incidents; highest offense only, excluding calls without reports. Classifications and UCR comparisons can change.[10]                                                        |
| AFD Fire Incidents 2023-2025                                    | `v5hh-nyr8` | `incident_number`           | Dispatched fire records for 2023–2025, not all Fire history; one row per incident is unproven.[11]                                                                                          |
| EMS - Incidents by Month                                        | `gjtj-jt2d` | `month_key`                 | Monthly incident counts by location and priority, not individual patient encounters.[12]                                                                                                    |
| Food Establishment Inspection Scores                            | `ecmv-9xxi` | `inspectionid`              | Inspection-score observations from the last three years, not complete inspection histories.[13]                                                                                             |
| Preventative Health Screenings Services provided by Demographic | `q2n9-6bj9` | `year`                      | Year and race/ethnicity and gender aggregate service counts, not individual clinical records.[14]                                                                                           |
| Water Quality Sampling Data                                     | `5tye-7ray` | `sample_site_no`            | Provisional creek, aquifer and lake analytical observations; retain parameter, result, unit and quality-control fields. Not drinking-water compliance records.[15]                          |
| KPI - Percent of Consumer Utility Complaints Resolved           | `k3s2-p7rw` | `service_request_number`    | Despite the KPI title, fields describe consumer complaints and their resolution workflow; do not treat records as precomputed rates.[16]                                                    |
| Real-Time Traffic Incident Reports                              | `dx9v-zd7x` | `traffic_report_id`         | Refreshing traffic incident snapshot; schema inspected only, with no source-row acquisition established here.[17]                                                                           |
| Affordable Housing Inventory                                    | `ifzc-3xz8` | `project_id`, `contract_id` | Subsidized or incentive-program project/contract observations, potentially across stages and mixed affordability; not all housing units. Do not infer parcel joins.[18]                     |
| % Access to Parks                                               | `8zqp-nigd` | `year`                      | Population access measure, not a complete facilities inventory.[19]                                                                                                                         |
| Annual Physical Circulation by Library                          | `kkkb-enqr` | `format`                    | Formats by branch for publisher-described fiscal 2025 circulation; no explicit fiscal-year column was observed, so a selected period cannot be inferred from a predicate on that field.[20] |
| 2025 City of Austin Demographic Profiles                        | `k4ue-wizq` | `name`                      | Area profiles published in 2025 using 2023 and 2024 data from multiple sources, not workforce or crash-victim microdata.[21]                                                                |
| EMS - Quarterly OMD Clinical Performance Indicators             | `2cxe-9vbj` | `fiscal_quarter_key`        | Quarterly clinical performance measures, not patient-level clinical encounters.[22]                                                                                                         |

Retain geometry in its native representation and coordinate reference system
where supplied; no ArcGIS alias or relationship follows from a similar name.
Bounded keyword discovery is dataset-only and does not establish complete
departments, stories, GIS services or historical coverage. Consult each source's
metadata and definitions before interpreting measures and dates.

## Sources

[1] https://services.austintexas.gov/cityclerk/cfdi/index.cfm
[2] https://services.austintexas.gov/edims/document.cfm?id=301923
[3] https://services.austintexas.gov/edims/document.cfm?id=247730
[4] https://services.austintexas.gov/cityclerk/lobbyist/index.cfm
[5] https://services.austintexas.gov/edims/document.cfm?id=293053
[6] https://datahub.austintexas.gov/api/views/3syk-w9eu.json — Issued Construction Permits
[7] https://datahub.austintexas.gov/api/views/nbzi-qabm.json — Zoning By Address
[8] https://datahub.austintexas.gov/api/views/86z9-i27i.json — Repeat Offender Registrations
[9] https://datahub.austintexas.gov/api/views/38mr-dwji.json — 311 Service Requests - Austin Transportation and Public Works
[10] https://datahub.austintexas.gov/api/views/fdj4-gpfu.json — Crime Reports
[11] https://datahub.austintexas.gov/api/views/v5hh-nyr8.json — AFD Fire Incidents 2023-2025
[12] https://datahub.austintexas.gov/api/views/gjtj-jt2d.json — EMS - Incidents by Month
[13] https://datahub.austintexas.gov/api/views/ecmv-9xxi.json — Food Establishment Inspection Scores
[14] https://datahub.austintexas.gov/api/views/q2n9-6bj9.json — Preventative Health Screenings Services provided by Demographic
[15] https://datahub.austintexas.gov/api/views/5tye-7ray.json — Water Quality Sampling Data
[16] https://datahub.austintexas.gov/api/views/k3s2-p7rw.json — KPI - Percent of Consumer Utility Complaints Resolved
[17] https://datahub.austintexas.gov/api/views/dx9v-zd7x.json — Real-Time Traffic Incident Reports
[18] https://datahub.austintexas.gov/api/views/ifzc-3xz8.json — Affordable Housing Inventory
[19] https://datahub.austintexas.gov/api/views/8zqp-nigd.json — % Access to Parks
[20] https://datahub.austintexas.gov/api/views/kkkb-enqr.json — Annual Physical Circulation by Library
[21] https://datahub.austintexas.gov/api/views/k4ue-wizq.json — 2025 City of Austin Demographic Profiles
[22] https://datahub.austintexas.gov/api/views/2cxe-9vbj.json — EMS - Quarterly OMD Clinical Performance Indicators
