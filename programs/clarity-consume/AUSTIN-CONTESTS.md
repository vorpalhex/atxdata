# Austin contests in county-administered results

Use the existing Clarity collector for Travis County elections containing Austin
contests. Do not create a second election downloader or substitute a guessed
municipal Clarity identifier:

    bun src/cli.ts collect --archive <private-archive> --date 2026-11-03
    bun src/cli.ts verify --archive <private-archive>
    bun src/cli.ts collect --archive <private-archive> --election 127492

The ID is a catalog-published Travis election ID, not a City of Austin ID. Either
ID or real calendar date selects the entire supported county election/version;
this is not a municipal-only collection flag. The existing finite request, byte,
row and policy limits apply unchanged. Reuse is offline verified, not a check for
fresh results; use the documented explicit refresh operation when required.

## Retain provenance and contest identity

Keep `sources.id = TX/Travis`, the election ID, observation ID and source version.
`result_rows.contest` is the original string contest key, including leading zeros;
its source label remains in the retained summary JSON (`K` and `C`). Resolve labels
from that observation's originals, not a newer summary or a global name table.
The same label/key in another county, election or version is not automatically
the same contest. Do not relabel county totals as complete municipal results.

The November 2026 native acquisition retained 23 explicitly City of Austin-labelled
contests in Travis election `127492`, source version `386718`. Examples include
`0069`, City Council Member, District 1, and `0074`, Proposition A - Full Purpose.
The corresponding 31,940 normalized rows are record counts, not votes or ballots.
Austin ISD, Austin Community College and other Austin-named jurisdictions are not
included in that City-labelled subset. Full Purpose and Limited Purpose proposition
records remain separate; do not merge them by proposition letter or infer their
population equivalence.

Whole-county coverage for this observation is 223 contests and 188,180 normalized
rows. The registered-total disagreement remains recorded, and certification remains
`not established`. This one bounded, source-versioned observation is not complete
history or an independent canvass. Native offline verification and both ID/date
reuse succeeded without additional requests. Originals and operational receipts
remain private, outside this source checkout.

## Other counties and City publications

These are separate, investigated sources, not implicit Clarity extensions:

- Hays County's November 2026 election page advertises PDF/searchable HTML and ZIP
  result publications and explicitly lists City of Austin election documents:
  https://www.hayscountytx.gov/873/November-3-2026-General-Election.
  Its result-PDF search entries and page labels are not interchangeable proof of
  certification. No Hays original result body or compatible structured endpoint
  has been acquired/validated by this collector.
- Williamson County publishes a results archive with election-year sections and
  separate result, reconciliation and audit publications:
  https://www.wilcotx.gov/292/Results-Archive.
  No Williamson result adapter, Clarity route or municipal-total crosswalk has
  been validated by this collector.
- City Clerk election notices, returns and historical publications are a separate
  document acquisition family:
  https://www.austintexas.gov/clerk/programs/elections.

Do not invent Hays/Williamson routes by replacing `Travis` in a URL, add county
values to this collector without a reviewed source adapter, or infer complete
Austin results from the Travis portion. Cross-county joins and certification need
separate published identities and evidence; matching names and dates are not
sufficient. No voter-level records are collected.
