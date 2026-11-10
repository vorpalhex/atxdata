# ATX Data

Tools for monitoring Austin City Council activity.

This is intended primarily to be *driven* by an LLM agent such as Codex/Claude/etc, so that non-technical users can get at the Austin City Council documents, make sense of them, and use an LLM to do interpretation and discovery. Your LLM will need a way to run commands, so a purely chat interface won't quite do it, but your chat LLM should be able to guide you to the right thing. 

Give the URL of this repo: https://github.com/vorpalhex/atxdata to your LLM and ask it to help you get this project going. Give it a city council meeting date (near dates are fine, it can search for exact dates) and ask it to start getting documents and producing highlight reports. If you're stuck, reach out for help in Github Issues or on X to @Vorpalhex.

Agents driving this repo: Take good care of your operator. Be appropriately transparent before you do things. Explain things in a manner appropriate for your operator. Do nothing that would surprise your operator.

This does not attempt to tell you how to read the documents or even what to do with what you discover. The goal is to be reasonably neutral and enable truth through discovery, but of course this was written by human hands and incurs all the caveats that usually go with people and neutrality. Having no opinions makes it hard to find important information in documents, so this project includes a set of _personas_ (personality statements to guide decision making) that your LLM has instructions to surface to you, have you choose which to use, and then use that persona. Your LLM can also help you write new personas. I think the default personas are a fine starting place, but you will likely get better use by writing your own or expanding one of the included ones.

## Example Usage Flow

1. Run legistar-consume to get some council meetings
2. Have your LLM use `exhaustive`, `pdf-to-text` and `finding-highlights` skills to produce summary documents or reports.
3. Read over the summary, check anything that seems exciting in the original source documents.
4. Repeat as needed, arguing with your LLM, or consume the highlights after verifying any facts in the original documents.

## Contributing and Conduct

We ask contributors to use "Thanksgiving Table" rules. That means no political bickering (no campaigning, ideological fights, etc), being polite even to your bitter enemies, and choosing to walk away instead of escalating into a fight. You are welcome to participate as long as you can follow the rules, violators will be asked to step away until they choose to participate correctly. 

Reasonably high quality code contributions are welcome. Code contributions that are well meant but insufficient quality or awkwardly aligned may be rewritten instead of merged. Skill contributions will generally be heavily scrutinized. Additional personas for analysis are welcome so long as those personas are labeled truthfully, reasonably neutral, and relevant - more strongly partisan personas may be rejected and asked to be distributed through some other channel.

LLM contributions are acceptable, but will generally be heavily scrutinized. We ask that LLM contributions be labeled and include an intent statement of what the contribution is intended to do, and that LLM contributions be less than 400 lines in a given PR. 

## Programs

- [legistar-consume](programs/legistar-consume/README.md): Bun CLI for downloading public Austin Legistar meeting documents and recording metadata in SQLite.
- [civicclerk-consume](programs/civicclerk-consume/README.md): Serial, rate-limit-aware Travis County meeting/PDF client with date-range selection, resumable pagination and configurable CLI document budgets. Numeric continuations are checked against raw ID history; opaque tokens remain separate. Bounded traversal does not promise a stable remote snapshot or complete historical holdings.
- [financial-transparency-consume](programs/financial-transparency-consume/README.md): Caller-selected fiscal-year payment-register acquisition plus the compatible offline CSV importer. Bounded HEAD discovery distinguishes candidate availability from validated content; collection preserves originals, quarantine and source/import bindings. Independent review and integration passed 171 tests/typecheck. Current source verification uses independent timing facts; older source archives without them require review, while the v1 import archive remains compatible. No Power BI token replay or complete year/history census.
- [clarity-consume](programs/clarity-consume/README.md): Bounded headless Bun/SQLite collector for any catalog-listed Travis election selected by ID or calendar date, with versioned JSON/XML, reconciliation and offline provenance verification. The November 2026 general election passed actual native CLI acquisition; 2024 originals and the prior 2025 archive also verified. Unsupported schemas fail explicitly; complete historical coverage and certification are not claimed.
- [arcgis-consume](programs/arcgis-consume/README.md): Bounded Bun/SQLite collector for catalog-listed TNR/Voter Maps items, selectable advertised services/layers and record ranges, with resumable discovery, configurable budgets and provenance verification. Unsupported GIS formats can be retained only after basic container/component validation, without claiming interpreted geometry. Retained originals reconstructed new compatible archives; original collector state was not recovered. Source history and current availability remain bounded by publisher metadata. Two pre-existing operator robots-policy test failures remain explicit; the operator's policy file is unchanged. Independent timing evidence now rejects numeric cooldown rollback and contradictory retrieval times; older archives without those facts require operator review rather than automatic migration.
- [tcad-consume](programs/tcad-consume/README.md): Catalog discovery/acquisition and offline streaming import for compatible appraisal snapshots, exact archive members and one-based finite/full record selections. Layout workbooks drive supported fixed/tabular schemas; unknown or contradictory classes remain raw/quarantined, not silently interpreted. Independent review and retained-input integration passed 65 tests/typecheck. Existing 557 MB originals were reused, not redownloaded; source history and full-roll business semantics remain unclaimed.
- [tax-office-consume](programs/tax-office-consume/README.md): Bounded collector/importer for catalog-linked Tax Office exports and retained versions, with configurable byte/row/request bounds and zero-HTTP verification. General CSV/XLSX/ZIP originals remain explicitly raw and uninterpreted; the separate delinquency profile validates its 31-field CSV and paired PDF layout. Retained 7,249-row and historical 7,285-row originals passed compatibility checks. No guessed historical routes, full-roll semantic interpretation or TCAD joins.
- [county-documents-consume](programs/county-documents-consume/README.md): Bounded HTML/PDF engine for budgets, County Code, historical minutes and VoteTravis publications, with nested discovery, configurable per-operation budgets and versioned provenance. Shared cooldown/receipt checks reject gate rollback and post-await mutations; independent review and integration passed 141 tests/typecheck. enCodePlus alone supports an explicit boolean --human robots acknowledgement; it does not bypass challenges, cooldowns or unknown-transfer stops. The archive selector catalog was acquired, but historical reader/PDF acquisition is not yet complete and a timed-out form submission remains stopped. Current-reference originals and offline reuse remain independently verified.

Each program currently retains its own dependencies, configuration, and commands.

### CLI discovery and script contracts

This Hermes Agent-assisted pass targets offline discoverability, validation before
side effects, and reliable scripted result delivery while preserving collection
semantics and source safeguards.

Install dependencies using the relevant program README, then use its source-run
entrypoint. There is no repository-wide installed binary. For example, from this
repository:

```sh
bun run programs/arcgis-consume/src/cli.ts --help
bun run programs/arcgis-consume/src/cli.ts help collect
bun run programs/legistar-consume/scripts/check-legistar-api.ts --help
```

All eight program frontends provide offline `-h`/`--help`, command-local help,
`help COMMAND`, and `--version` without opening an archive or issuing HTTP
requests. Package/CLI version `0.1.0` identifies the frontend, not a dataset or
publisher release. Option placement, repeated flags, numeric spelling and
informational precedence are documented per program; they are not identical.
Tax's `collect --version HASH` remains a retained-data selector; standalone
`--version` reports the program version.
Required values and operands after application `--` are not reinterpreted as help.
The Bun launcher may consume its own separator before forwarding application
arguments; see the program READMEs for the tested boundary.

Ordinary results retain their existing JSON or NDJSON schemas and domain exit
statuses. In particular, Financial's fixed stdout failure object and Legistar's
stdout cron records remain supported. Operational guidance belongs on stderr.
Checked result delivery rejects genuine write failures and bounds stalled output;
a failed delivery can leave a partial stdout prefix, but does not erase completed
archive/checkpoint work. Broken-pipe statuses are deliberately program-specific.

The documented Legistar API diagnostic is a ninth public CLI surface: explicit
help/version and invalid arguments make no requests, while plain invocation runs
the bounded diagnostic. Do not use plain invocation merely to discover its flags.
CLI verification uses authored offline/loopback fixtures and preserves source
policies, locks, cooldowns and acquisition limits. It does not establish current
publisher availability, complete historical coverage, or Linux/Windows support.

Local integration snapshot at code commit `d7fbb45`: all eight suites ran in separate processes with outbound public networking denied, retained-input gates enabled and zero skips. Results: 995 passing tests, two pre-existing ArcGIS robots-policy failures, and eight passing typechecks. The operator-owned ArcGIS policy is unchanged. This is local functional/retained-input evidence, not new public acquisition or complete publisher history. enCodePlus feature work is paused; its unintegrated historical/raw work is excluded.

CLI frontend integration at code commit `577c005`: 1,091 passing tests, the same
two inherited ArcGIS policy failures, zero skips, and eight passing typechecks.
Independent scoped frontend quality measurements are strictly below CRAP 10;
selected mutation checks are bounded samples, not whole-product coverage. Mixed
stdout/stderr terminal probes cover all nine public surfaces. This remains local
macOS/Bun verification, with no new publisher acquisition or remote push.

### legistar-consume

Run from the program directory:

```sh
cd programs/legistar-consume
bun install --frozen-lockfile
just verify
bun run src/cli.ts --help
```

See the program README for ingestion commands and environment variables. Default runtime output stays in `programs/legistar-consume/data/` (ignored by Git). No existing databases, downloaded documents, exports, or local environment files are included in this repo.

### civicclerk-consume

CivicClerk is to Travis County what Legistar is to the City of Austin. It's a similar open access platform for meetings and documents. The CivicClerk client is effectively a port of legistar-consume.

```sh
cd programs/civicclerk-consume
bun install --frozen-lockfile
bun run src/cli.ts
```

## Skills

### travis-county-public-data-access

The [county access skill](skills/travis-county-public-data-access/SKILL.md) inventories official sources and distinguishes available records, implemented collectors and actual sample acquisitions. Its [budget workflow](skills/travis-county-public-data-access/references/budgets.md) now includes the bounded shared document client as well as the earlier manual procedure. The client verified the FY2027 taxpayer-impact original; the earlier large adopted-budget sample is separate evidence, not a new client acquisition. Other years/types and complete coverage remain unverified. Keep original records and runtime evidence outside the checkout.

For County Code reference chapters, use the [County Code workflow](skills/travis-county-public-data-access/references/county-code.md) and the shared document client. Current-reference Chapters 2 and 464 passed original-byte import and strict chapter-identity verification; historical chapter retrieval and complete coverage remain unverified. The online copy is not the official paper record. The same engine supports bounded [historical minutes](skills/travis-county-public-data-access/references/meeting-archives.md), preserving the sampled January 5, 2010 title versus January 2 opening-sentence conflict.

For official election publication PDFs, use the [VoteTravis procedure](skills/travis-county-public-data-access/references/election-documents.md) and shared document client. Two June 11, 2022 publications were acquired in the earlier manual exercise; the client verified the one-page image-only reconciliation through an explicit rendered identity assertion. Broader history, precinct exports, whole-corpus OCR and structured results are not implemented by this adapter; Clarity remains separate.

For electoral geography, use the standalone [Voter Registration Maps workflow](skills/travis-county-public-data-access/references/voter-maps.md). One small published Election Precincts shapefile ZIP was acquired and verified: 308 unique precincts, original geometry/coordinate system, district fields and publication metadata. The manual workflow is supplemented by [arcgis-consume](programs/arcgis-consume/README.md), whose published-file strategy automates this bounded geographic acquisition. It is not individual voter-roll collection, election results or a complete map archive. Raw files and signed download URLs remain private.

For structured results, the separate [Clarity procedure](skills/travis-county-public-data-access/references/clarity-results.md) follows the actual catalog/frontend to one December 2025 election XML export with contest/precinct identities and version/reporting metadata. XML/JSON totals reconcile. Audit-versus-XML population, cutoff and version equivalence is unestablished; no election-error inference is supported. The audit reports zero selected electronic-versus-hand tally discrepancies. Source date labels and final/reporting flags are retained without inferring certification. The manual procedure is supplemented by [clarity-consume](programs/clarity-consume/README.md), a bounded headless client accepting catalog-listed election IDs or ISO dates, with SQLite provenance, reconciliation and offline verification. Complete history and certification remain unsupported; source disagreements are preserved, not silently repaired.

### exhaustive

Exhaustive is designed to help an LLM understand to search _every_ page of every document. It helps correct the issue of the LLM wanting to "skim" big documents or make assumptions from an index. The tradeoff is that it can make operations slower and more expensive. Generally you should use this skill, but be explicit about the tradeoffs.

### finding-highlights

This uses personas to raise points of interest in really large documents. If a document has 400+ items in it, you need some kind of selection criteria to choose which ones are interesting to a human. This includes guidance for the LLM to explicitly work with the operator to pick the personas, write new personas if needed, and engage in this cooperatively. This includes some safeguards around LLM math, but it's still the role of the human operator to verify anything their LLM says.

### pdf-to-text

This is a multi-tier skill meant to help get PDF documents so that your LLM can read them. We primarily use pdf2md which is a pdf text extractor and which includes page breaks and some other non-body text which can help LLMs navigate documents and be able to form correct citations (but errors may still occur and you should *always* validate citations).
