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

Inspect each asset through the current catalog. Retain report identities,
amendments, transaction types and source field names. An amount in a summary,
loan, credit or transaction-detail table is not automatically another contribution.
Structured records do not establish that all historical original filings survive
or have been collected. The separate candidate filing-status asset and original
filing documents are not silently merged into these tables.

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

The master view is not a substitute for every activity or relationship table.
Preserve identifiers and lookup relationships without asserting that a contact,
registration, question or expenditure proves improper influence. Departmental
visitor logs returned by a keyword search are separate sources, not implicitly
part of a lobbyist report.

Official source: https://services.austintexas.gov/cityclerk/lobbyist/index.cfm.

## Council votes, permits and departmental operations

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
- Issued Construction Permits: `3syk-w9eu`. Issuance is not the same event as an
  application, inspection, zoning decision or enforcement case. Discover and
  inspect those separate assets instead of assigning them permit semantics.
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
