# arcgis-consume

Read-only Bun/SQLite acquisition from the TNR, Voter Maps and Austin GeoHub catalogs, plus explicitly item-linked public layers discovered through the official Austin Water dashboard. Sources are `tnr`, `voter`, `austin` and `water`. County presets remain compatible; city collect/sync requires an explicit catalog-backed `--item` and advertised `--layer`. `--service` is only a matching assertion, not arbitrary URL permission. Fields and finite operating budgets are configurable; proof budgets are not production caps.

## Austin and Water source scope

`austin` derives its catalog groups from the published GeoHub site configuration. Compatible selected services are scoped to `maps.austintexas.gov/arcgis/rest/services/` or hosted city tenant `services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/`. Catalog/item agreement, advertised layer membership, native schema/CRS, complete before/after counts and IDs remain required. Catalog membership does not authorize personal records or every listed dataset. Select only approved public data and safe attributes.

`water` retains the official water-leaks page's dashboard association, the dashboard's explicit map widgets, public Web Map definitions and their item-linked numeric layer endpoints, including grouped layers. Repeated aliases for the same item/layer are deduplicated; distinct publisher item identities remain distinct. Unlinked layers and dashboard chart expressions are not collected. Hosted service access is scoped to `services1.arcgis.com/PuB3FWUAxkScvfQy/`. No account, owner, service-address or private-infrastructure enrichment occurs. Original metadata remains private even when a safe attribute projection is selected.

A real shipped-CLI Water run acquired the complete current seven-feature `LWOPR_View` point layer, map-linked public item `3817d04dbb29486e9469510fe1e63156`, advertised layer `0`. The explicit projection is `OBJECTID,COMPFLAG,STARTFLAG`, retaining native XY geometry and CRS `102100` / latest `3857`; no address, work-order, creator/editor or contact attributes were selected. These are public operational incident locations, not anonymous aggregate areas. Native offline verification and exact reuse added no requests. This is one current observation, not all Water holdings or history.

The separate outage polygon layer was observed as 7,775 records during count-only reconnaissance. Its map-linked item `60736b279f964313a52e768f81a76109` was inaccessible; the distinct serviceItemId was not substituted and no polygon prefix was collected. PropertyProfile/FloodPro wrappers remain catalogued but their underlying acquisition routes are unresolved; wrapper traversal is not claimed. City evidence remains one complete ten-boundary observation acquired as originals and replayed through the CLI, not a fully-live City CLI invocation or all city GIS.

For these two hosted city/Water authorities only, a completed HTTP403 at the exact `/robots.txt` route can be recorded as an explicitly approved RFC9309 unavailable-policy outcome. The original failed status, headers and provider timing remain unchanged; no successful robots body is synthesized. Error bodies are not retained by the shared provider, so `bodyRetained:false` is explicit; retained reconnaissance bodies are separate evidence. Actual-resource403,429,5xx, unknown transfers, malformed holds and manual stops do not gain permission. The separate maps-authority robots redirect to HTML remains unresolved. Operator-owned `rules.ts` and its two inherited Disallow failures are unchanged.

Native source-run examples (Bun and the sibling modules described below are required):

```sh
cd programs/arcgis-consume
bun src/cli.ts list
: "${ARCHIVE:?Choose an absolute private archive outside every checkout}"
bun src/cli.ts rules --source austin --archive "$ARCHIVE"
: "${CATALOG_TERMS_SHA256:?Review catalogTerms.sha256 from rules}"
bun src/cli.ts discover --source austin --archive "$ARCHIVE" \
  --terms-sha256 "$CATALOG_TERMS_SHA256" --max-pages 1000
: "${ITEM_ID:?Choose an approved item returned by discover}"
bun src/cli.ts rules --source austin --item "$ITEM_ID" --archive "$ARCHIVE"
: "${LAYER_ID:?Choose an actual advertised layer ID}"
: "${FIELDS:?Choose safe actual attributes including the native OID}"
: "${ITEM_TERMS_SHA256:?Review the selected item terms.sha256}"
bun src/cli.ts collect --source austin --item "$ITEM_ID" --layer "$LAYER_ID" \
  --fields "$FIELDS" --archive "$ARCHIVE" --terms-sha256 "$ITEM_TERMS_SHA256" \
  --max-records 1000000 --page-size 1000 --max-requests 1000 --max-bytes 268435456
# Repeat collect for verified offline reuse; use sync explicitly for freshness.
bun src/cli.ts verify --archive "$ARCHIVE"

# Water metadata discovery only; this is not approval to collect the large layer.
bun src/cli.ts rules --source water --archive "$ARCHIVE"
# Review the Water dashboard catalogTerms separately, then:
: "${WATER_CATALOG_TERMS_SHA256:?Review Water catalogTerms.sha256}"
bun src/cli.ts discover --source water --archive "$ARCHIVE" \
  --terms-sha256 "$WATER_CATALOG_TERMS_SHA256" --max-pages 1000
```

Use one designated serial archive/request owner per source authority. Independent roots do not coordinate cooldowns. The examples expose the shipped interface; no fresh public requests were made during quality repair. Native fixture tests exercise the selection/reuse path, and retained city/county bytes are replayed into NEW ledgers under public-network denial, not represented as recovered old timing history or a fully-live CLI run. Optional `ARCGIS_CITY_INPUTS` enables the retained-city regression alongside `ARCGIS_ORIGINAL_INPUTS` for county originals.

## CLI frontend contract

Commander 14.0.3 defines and consumes the CLI options and command registry; generated help retains the source workflow and safety notes. Small local compatibility guards preserve the published duplicate/value/terminator and informational-precedence contracts rather than adopting different parser defaults. Each program owns its dependency and frontend; no shared parser package is required.

`bun run format` and `bun run format:check` use pinned Prettier 3.9.10 on the explicit CLI-only paths in package.json. Collector/domain files and generated lockfiles are outside that formatting scope.

The declared initial package/CLI version is 0.1.0 (not a publisher or upstream release). `--version` prints it without opening an archive. `-h`, `--help`, and `help COMMAND` provide offline help; command-local help lists its requirements and the workflow. Required option values and tokens after application `--` are never help or command selectors. Bun consumes its first `--`; pass a second `--` when the application must receive the boundary. Operands after that boundary are rejected because this CLI uses named target options, not positional file inputs.

Long values accept both `--name=value` and `--name value`. All known options can precede or follow the command; their operational scope is unchanged: a command consumes only the options relevant to it (e.g. status ignores selection filters). Unknown/duplicate options and empty/incomplete values fail with status 1; no prefix matching or positional catch-all exists. Required split values beginning with `--` are rejected as missing values, not interpreted as help; use equals for literal option-like values. There are no grouped short operational flags. Informational options bypass unrelated option/required-target errors, but an unknown command remains an error; the last informational option wins. Repeated operational options remain errors. Numbers retain their existing decimal-digits-only bounds (including leading zeros); no exponent/decimal/negative coercion is added.

Normal operational stdout remains pretty JSON with its existing keys/order and a final newline. No color, pager, prompts or stdin reading is added; `TERM` and `NO_COLOR` do not affect machine bytes. Errors retain status 1 on stderr. Delivery now checks native writes and awaits flush. A non-EPIPE output failure (including EBADF/ENOSPC, or five seconds of downstream backpressure) returns 1 with a concise code-only diagnostic, without result bytes, paths or stacks in that diagnostic. Already completed archive/checkpoint facts remain completed; a delivery error never rolls them back or implies acquisition failed. Quiet EPIPE retains legacy status 0 and no diagnostic; it means the consumer closed, not proof that the consumer received all bytes. This is an explicit correction to prior false success for other stdout failures. The five-second bound is output delivery only, not a transport deadline change.

Frontend regression tests ship in `test/frontend-native.test.ts`. Use a private external `TMPDIR`, isolated HOME/XDG/cwd and OS public-network denial with only explicit localhost fixture access for the full suites. The FIFO backpressure portion uses POSIX `mkfifo` and is not exercised on Windows; no Windows support claim is made. These are source-run Bun entrypoints, not an installed binary. Frozen offline installation is `bun install --frozen-lockfile --offline --ignore-scripts`; no dependency upgrades are needed.

Plain invocation intentionally retains status 1/stderr, now with useful full usage. Explicit help is status 0/stdout. Help exposes `list -> rules/catalogTerms -> discover -> rules/item terms/layers -> collect`, the catalog versus item hash distinction, and legacy bare-preset routes. Successful list preset ordering and summary/run/reused schemas are unchanged. `src/rules.ts` and the two known robots-policy assertion failures remain untouched; this frontend repair does not claim Disallow enforcement. Optional retained-original tests remain skipped without an explicit `ARCGIS_ORIGINAL_INPUTS` manifest; no source data needs to be acquired for these tests.

## Supported scope

- Discovery follows all returned catalog continuations within the selected page/request/byte budgets. The current hub configuration supplies the group predicates; all item types in those groups are enumerated. It is not an organization-wide search. Repeated identities, changing totals, incorrect positions and incomplete terminal pages fail rather than silently truncate.
- Public Feature Service / Map Service items can use HTTPS county `gis.traviscountytx.gov/.../rest/services/.../FeatureServer` or `MapServer`, or the catalog/item-matching vendor route `services1.arcgis.com/<tenant>/arcgis/rest/services/.../FeatureServer` or `MapServer`. Tenant/path permission comes from exact agreement between the configured hub catalog and selected public item metadata, not a fixed two-item/tenant allowlist. Vendor requests have their own authority-specific robots/crawl-delay gate. Advertised numeric layer suffixes are parsed separately from the service root; explicit `--layer` must equal that suffix (if present), appear in service metadata and match both layer metadata IDs. Original advertised source identity is retained. `--service` asserts the matching root or advertised endpoint, including on cached reuse; it never permits arbitrary URL acquisition. Other authorities (including unproven taxmaps routes), credentials, ports, query strings and non-service routes are rejected. No `/0` guessing or layer substitution for an explicitly supplied item.
- Feature schemas come from the layer metadata. By default every advertised attribute is requested; `--fields` selects a complete explicit projection including the layer's OID. Numeric, string, date, GUID and related supported ArcGIS scalar types are checked. Unknown attribute types fail explicitly. Original attributes, field definitions, native spatial reference, units, extents, capabilities and metadata remain in unchanged response bodies.
- Native XY point, multipoint, polyline, polygon and envelope geometry are supported, including legitimately null shapes. Coordinates are finite and inside the advertised extent with a 0.01-native-unit allowance; rings must close. Z/M, meshes, rasters, nonspatial tables, attachments and export jobs are not implemented. No reprojection or invented geometry occurs. Page CRS identities must match metadata; service-only tolerance metadata need not be repeated in page responses.
- Ordered pagination is used only when the layer advertises pagination and ordering. Page size is capped by `maxRecordCount`. Otherwise the complete authoritative ID set is queried in bounded batches, independent of response order. Truncated/missing/duplicate batches fail. A service that cannot supply complete count/ID evidence is unsupported rather than silently sampled.
- Published item downloads use the selected item's actual advertised name, size, identity and timestamps. Direct bodies and manually validated `www.arcgis.com/itemdata/.../<advertised-name>` redirects are supported. Signed access URLs remain private provenance, never permanent source identities.
- Shapefile interpretation supports one flat, matching-basename polygon SHP/SHX/DBF/PRJ group, optional encoding/metadata files and additional safe members. It validates all member CRCs, bounded declared/actual expansion, dynamic DBF fields/record lengths/counts, sequential SHP/SHX identities and polygon geometry. Records are identified by their native record ordinals, not an assumed unique Precinct column. Original DBF/PRJ/CPG and other components remain inside the unchanged ZIP; native PRJ text is retained, not transformed. Complete nonpolygon, Z/M or multiple-shapefile groups can be retained raw with `semanticStatus: unsupported`, `records: null`: only the ZIP container/CRC, component presence and basic SHP/SHX headers are checked, not their geometry, DBF records or CRS semantics. Invalid containers, unsafe members, CRC failures, missing components and invalid/mismatched headers still fail; corrupt supported polygon semantics are not downgraded to unsupported. Unsupported encodings and incompatible interpreted schemas fail explicitly. This is not a general shapefile/WKT topology parser.
- Other advertised file formats may be retained with `semanticStatus: opaque-unsupported`, `records: null`; this is byte acquisition, not validated geometry. Missing/unsafe filenames or incompatible metadata fail. HTML challenge bodies are not accepted as data. Web maps/apps are not generally traversed: only the explicitly scoped Water dashboard-to-Web-Map discovery described above is implemented, without personal-dataset enrichment.

Catalog inclusion is not authorization to collect address points, owners, forms or individual voters. Review the subject, fields, current usage terms and operational permission before collecting. There is no authentication, cookie import, challenge bypass, arbitrary URL scraping, editing, scheduler, service or historical backfill.

## Install and use

Run in this directory; the sibling CivicClerk and Legistar modules are required. Dependencies are pinned in `bun.lock`; Bun 1.3.14 was exercised.

```sh
bun install --frozen-lockfile --offline
bun src/cli.ts list
: "${ARCHIVE:?Choose one absolute private archive outside every checkout}"

# Preset rules include both selected-item terms and hub catalogTerms.
# rules also returns advertised service layers, without feature queries.
bun src/cli.ts rules --source tnr --archive "$ARCHIVE"

# Use catalogTerms.sha256, not the selected-item terms hash, for discovery.
: "${CATALOG_TERMS_SHA256:?Review catalogTerms from rules}"
bun src/cli.ts discover --source tnr --archive "$ARCHIVE" \
  --terms-sha256 "$CATALOG_TERMS_SHA256" --max-pages 1000

# Pick an actual catalog ID. Review its terms and advertised layer IDs.
: "${ITEM_ID:?Choose an ID returned by discover}"
bun src/cli.ts rules --source tnr --item "$ITEM_ID" --archive "$ARCHIVE"
: "${LAYER_ID:?Choose an advertised layer ID}"
: "${TERMS_SHA256:?Review the selected item's terms.sha256}"
bun src/cli.ts collect --source tnr --item "$ITEM_ID" --layer "$LAYER_ID" \
  --archive "$ARCHIVE" --terms-sha256 "$TERMS_SHA256" \
  --page-size 1000 --max-records 1000000 --max-requests 1000 \
  --max-bytes 268435456

# Optional: --fields OBJECTID,NAME (use actual names and include actual OID)
# Optional: --service 'https://gis.traviscountytx.gov/.../FeatureServer'
# Its value must match BOTH the selected catalog item and item metadata.

# Select a published file from either catalog; no --layer is needed.
# Voter preset omits --item and selects Election Precincts as a convenience.
bun src/cli.ts rules --source voter --archive "$ARCHIVE"
# Review that item's own terms hash before the next command.
bun src/cli.ts collect --source voter --archive "$ARCHIVE" \
  --terms-sha256 "$TERMS_SHA256" --raw-bytes 134217728 \
  --expanded-bytes 536870912 --max-records 1000000

bun src/cli.ts status --archive "$ARCHIVE"
bun src/cli.ts verify --archive "$ARCHIVE"
```

If the preset disappears from its hub, `rules` still returns hub `catalogTerms` and explicitly marks `selectedItemUnsupported`. Source-wide discovery does not depend on that demonstration item still being published.

`collect` reuses a verified successful selection without HTTP; it is not a freshness check. Selection identity includes source, item, layer and field projection. `sync` makes a new bounded observation and retains older versions. Legacy preset collection semantics remain supported through the bare-preset CLI, but all archive access now requires independently verifiable timing evidence (see below). Use an explicit `--item` or `sync` to acquire through the general engine rather than reusing an old preset collection.

After a settled interruption, repeat its command/options with `--resume RUN_ID`. Catalog pages and feature batches already checkpointed are verified and reused, then acquisition continues. An unfinished dispatched transfer has unknown completion timing and requires explicit operator review instead of automatic retry. Selection, page size and budgets must match the original run. Attempts and received/reserved bytes remain cumulative; server cooldowns persist across runs and processes. Exhausted operation budgets are not reset by resume. Choose adequate finite budgets before starting; an explicitly larger new operation is not permission to erase old history or server policy. No byte-range appends to mutable files, automatic stale-lock stealing or history deletion are supported.

## Budgets and transport

General CLI defaults (all numeric overrides require finite positive safe integers; layer IDs may be zero):

| Option             |   Default | Meaning                                                        |
| ------------------ | --------: | -------------------------------------------------------------- |
| `--max-requests`   |      1000 | All attempts in this operation, including robots and redirects |
| `--max-bytes`      | 268435456 | Combined received/reserved response bytes                      |
| `--response-bytes` |  16777216 | Each metadata/count/ID/feature response                        |
| `--raw-bytes`      | 134217728 | Each published file                                            |
| `--expanded-bytes` | 536870912 | Combined ZIP declared/actual expansion                         |
| `--max-records`    |   1000000 | Complete selected feature/file record count, not a prefix      |
| `--max-pages`      |      1000 | Catalog pages and feature pages, separately bounded            |
| `--page-size`      |      1000 | Requested features per page/batch, capped by server metadata   |
| `--max-members`    |      1000 | ZIP members                                                    |

These are configurable operating bounds, not observed source sizes. Responses are streamed to private, no-clobber raw paths. JSON and bounded ZIP semantic validation then use memory; very large explicitly configured ZIPs require corresponding memory. Feature pages are persisted separately rather than accumulated as one feature roll. Whole-layer IDs are bounded by the count/response budgets and retained for completeness reconciliation.

New general operations have no hidden retries or automatic redirects. A transfer has a 45-second deadline. At most one complete transfer is in flight; the completion-to-next-start gap is at least 3 seconds or a stricter robots/server delay. Retry-After and supported rate-limit instructions are honored even on HTTP 200; uninterpretable cooldown instructions persist a manual-review stop. Native fetch does not import browser cookies or credentials.

IMPORTANT baseline policy: the operator's `src/rules.ts` change in base 99dd488 comments out robots Disallow rejection. This repair deliberately does not restore or otherwise edit it. Crawl-delay and HTML/challenge checks still run. Do not claim that current code enforces Disallow. The two existing tests expecting Disallow rejection fail in the untouched baseline and remain failures, not weakened tests.

## Persistence, compatibility and verification

One trusted archive/writer uses the existing CivicClerk lock/symlink/no-clobber promotion and Legistar streaming writer. No sibling source files changed. `state.sqlite` retains sources/permanent URLs, operations, attempts, private headers/temporary URLs, hashes, timestamps, cooldowns, checkpoints and byte-version history. `acquisition_options` adds immutable general selection/budget records without rewriting older collection summaries or originals. `list` reports general defaults and separately labels `legacyArchiveLimits`; older `status.limits` is the backward-compatible legacy fallback, while each general run's actual policy lives in `acquisition_options`.

Attempts reserve their full available per-response allowance before network activity. Process death leaves that conservative charge and any partial provenance; clean settlement reconciles measured bytes. Unknown legacy zero-byte unfinished transfers stop for manual review. Pending validated files recover against their original size/hash checkpoint; promotion never overwrites an existing original. Failed stream `.part` output follows the existing writer cleanup contract and is not falsely described as a complete original.

`verify` sends no HTTP. It checks SQLite/FKs, every retained checkpoint and bidirectional byte-version history, then recomputes each successful collection's semantic summary. General collections also verify retained hub/catalog identity and complete catalog pagination, selected service/layer identities, page schemas/native CRS, complete before/after counts/IDs and unchanged before/after item/layer/service metadata. Published item metadata must agree before/after and signed download paths remain distinct from permanent item data URLs. A stable count/ID/version check is not a transactional snapshot guarantee: services that do not expose an edit marker can still change in-place between requests. Source publication date remains unknown rather than inferred from retrieval or item modification dates.

General feature verification reconstructs exact item/service/layer/count/ID/page request URLs and kinds from persisted selection and metadata (including where, fields, order/offset or ID batch), and reconciles each checkpoint's creating attempt identity. Matching hashes alone do not validate query provenance. Runtime library selections are validated before cache/source writes. Generic Archive/Store budget validation is separate from GIS selection validation, so budget-only raw-file/CSV consumers remain supported. Optional generic `budget.records` is a positive safe-integer ceiling, preserved for existing Financial archives; it is not required for GIS transport budgets and never silently dropped. Invalid persisted budgets fail before cached requests or recovery without deleting attempts, byte reservations or history; legacy runs without options retain their existing defaults.

The cooldown singleton is mandatory existing policy, not a default to recreate. Existing databases must contain exactly id1 and a numeric, finite, nonnegative safe-integer timestamp. Cache reads, verification/recovery, spacing and source/run/history/reservation writes preflight this policy. `defer` validates both input and existing state before a monotone update; it cannot normalize damaged state. A missing/zero-byte database initializes only in an otherwise empty archive (plus the owned lock), supporting Financial's private empty-file preallocation without resetting retained-body/sidecar evidence. Deleted policy in an initialized database fails closed. `Number.MAX_SAFE_INTEGER` remains a deliberate durable manual-review stop: new operations/cache/recovery stop, while the already-started response attempt may finish accounting without clearing the stop. Retry jitter is rounded upward to integral milliseconds.

`timing_events` adds independent, provider-owned append-only facts for spacing/defer, reservation, dispatch, header receipt, checkpoint and full-body completion. The mutable numeric gate must be at least every recomputed retained obligation, including successful-response Retry-After/rate limits and completion-based spacing. A valid integer rollback is corruption, not elapsed policy: it fails before reads/cache/offline verification or new writes/transport, without raising the gate to hide the contradiction. Stricter minimum/robots spacing persists across reopen. Unknown response instructions retain the manual stop. A dispatched transfer without completion evidence stops on reopen without deleting its reservation or partial body.

Clock domains are explicit: run/attempt ISO timestamps use wall-clock; observation retrieval and transport deadlines use `Dependencies.now`. `clockDomain` is optional; it defaults to `unix-epoch-ms`, or `injected-epoch-ms` when `now` is supplied. Stable custom labels are supported. Facts retain separately sampled provider-clock and wall-clock milliseconds; do not compare these two domains directly. Valid offline verification does not depend on the reader clock. A new operation cannot silently switch clock domains or roll its recorded clock backward. Checkpoint retrieval is bound to independently captured clock facts, not bounded by mutable cooldown.

Read-only shared consumers can import `timingSchema` and `validateTiming(db, gate)` from `src/timing.ts`. Schema allowlists must admit the exact eighth table. Returned `observations.get(run + "\0" + label)` exposes `{domain,retrievedMs,lowerMs,upperMs,wallMs}`; the upper bound is a captured checkpoint clock, reconciled with completion, never the gate. The attempt map additionally exposes separately labelled reservation/header/completion samples and their wall-clock mapping. Gate type/singleton and manual-review-stop checks still apply; this function validates evidence, not permission to ignore a manual stop or sleep. Consumers must not retain gate-derived retrieval ceilings.

Existing databases without these independent facts are preserved unchanged and require explicit operator review. No legacy receipt/completion times are inferred from mutable observations, wall-clock attempt timestamps in a different domain, the current clock, or the mutable gate. There is no automatic migration, gate repair, history deletion or fabricated timing. Legacy semantic compatibility tests reconstruct new evidence-bearing ledgers from retained original bytes; they do not establish that a genuine old collector ledger has sufficient timing evidence.

Raw unsupported shapefile acceptance additionally checks basic DBF headers, positive record size and exact declared body lengths, plus nonempty required PRJ, for every discovered group before capability classification. This is structural corruption detection, not decoding unsupported geometry/DBF/CRS semantics.

Optional actual-original regression: set `ARCGIS_ORIGINAL_INPUTS` to a local manifest mapping absolute readonly input files to byte counts/SHA256, then run `bun test test/retained-originals.test.ts`. It reconstructs NEW legacy-format ledgers from the original4-polygon/308-record bytes, with explicitly authored policy/transport fixtures, then exercises native CLI verify/reuse without HTTP. It does not recover old collector state, prove original chronology or establish current remote availability. All generated archives remain in external TMPDIR.

The original `Archive` and `Adapter` APIs and legacy semantic validators remain for old archives. New library callers use `selectionOptions` and `executeSelection` from `src/selection.ts`; the CLI uses that same engine. Legacy validators' five-field/two-row/named-ZIP contracts describe old retained observations only, not general CLI restrictions.

## Evidence and limits

This repair's local fixtures exercise multi-page catalogs and catalog interruption/resume, a nondefault item/layer with 13 complete rows, server page ceilings, unordered ID-batch fallback, multiple native XY geometries, scalar/schema/CRS faults, successful cooldowns, cumulative budgets, service/count/ID drift, missing catalog provenance, old-preset reuse, and a different 1001-record shapefile ZIP larger than 1 MB with seven members. Fixture bytes are synthetic and are not presented as county acquisitions.

A separately bounded live metadata-only exercise completed TNR catalog discovery and obtained the preset item's advertised service and layer metadata: 8 attempts, 166868 response bytes, minimum recorded completion-to-next-start gap 3.001 seconds. One response was the retained GIS robots 404; all others were 200. No feature queries, person-level records, files or export jobs were requested. Current TNR layer metadata advertised 10 attributes, native State Plane feet (wkid 102739/latestWkid 2277), and maxRecordCount 2000. This proves metadata availability and schema compatibility, not new live feature/file acquisition or historical coverage.

Historical evidence, not a fresh acquisition: the previous implementation retained four TNR polygons and a 308-record Election Precinct ZIP. Original page SHA-256 values were `4d151fb29b4891d07feb284c152dafbb13ad382cc99a443ac7348c430d037897` and `a2e9e6186f4746301276e06ad76bd5c63dfc2c05aed68bf6de880869fb0910f9`; ZIP SHA-256 was `108837b38a9f913740577b5ab0784c40022df20ea0e00930b56ba0b9bb145c41`. The old semantic/reuse paths are regression-tested, but locating and replaying those two actual historical archives remains an explicit handoff criterion, not a claimed current pass.

Run tests with a private external TMPDIR and an OS outbound-network denial boundary that permits localhost fixtures. Keep coverage/metrics/mutation workers outside every checkout, in a private repository-layout mirror. Frozen offline installation succeeded; all changed files remain local and unstaged. Full-suite/typecheck, scoped mutation/CRAP/dryer receipts and residual classifications accompany the handoff. Independent review and acceptance remain chief-owned.

The unchanged policy exceptions are exactly `robots longest-match rules, agent groups and stricter crawl-delay are respected` and `robots /query disallow is enforced before any feature query`. No other failures are accepted as policy exceptions.

### Application metadata development slice (not acceptance clearance)

`inspect-app --source austin --item CATALOG_APP_ID --archive ABSOLUTE_PRIVATE_DIRECTORY --catalog-terms-sha256 CATALOG_TERMS_SHA256 --terms-sha256 ITEM_TERMS_SHA256` is a metadata-only operation for arbitrary public Web Mapping Application members of the complete source catalog. Review actual native `rules` catalog terms, run `discover` with that catalog hash, and review selected-item `rules` before supplying the separate item hash. Existing positive finite budget flags apply to policy, site, complete paginated catalog, item and itemData together. A one-page fixture costs six requests; a four-page catalog costs nine, not five.

This slice has only injected-fixture evidence, no authorization for a live Portal request or new live root. It retains JSON representation bytes through existing text observations so arrays, scalars and null can have honest versioned metadata dispositions; only JSON syntax runs inside transfer validation. Semantic error, empty and unsupported data are not parsed as apps/maps. Metadata-only summaries expose no records count, and explicitly deny wrapper resolution and feature/file acquisition. The two known catalog IDs are not an allowlist. Existing native legacy/Water behavior and maps robots restrictions are unchanged.

Native verify/reuse dispatch is separate from feature and published-file completion. Receipts bind producing observations/attempts and historical route policy. Metadata receipts remain private. This is an unfinished development slice: complete policy/budget/lock/replay adversarial coverage, quality metrics, causal omissions, sanitizer, independent review and real-source proof remain gates. Do not treat successful metadata fixtures as wrapper or City acquisition acceptance.

Application eligibility requires a represented absolute HTTP(S) published URL, with a nonempty authority and no credentials, literal whitespace/control characters or backslash repair. The item must match the exact original catalog URL string; validation does not normalize or follow it. Invalid catalog eligibility fails before app itemData, after retaining complete catalog JSON, without an unknown-wire hold. A completed but mismatched item remains metadata-only item-unavailable with no itemData request. A published URL is metadata, never permission for application navigation.

For Portal-only application terms review use `rules --app-only --source austin --item CATALOG_APP_ID --archive ABSOLUTE_PRIVATE_DIRECTORY`. This public CLI flag requires an explicit catalog member and reads only source policy, site, complete catalog and current item JSON. Both catalog and current item must remain public Web Mapping Applications with the reviewed exact published-URL eligibility. A complete non-app/current-role response is retained, then rejected semantically before service-origin policy, service metadata, HTML, app itemData or features. Distinct current catalog/item terms are returned without automatic acceptance. Ordinary `rules` retains its existing service-inspection behavior when the flag is omitted. The flag is immutable on same-run resume and grants no live-source or navigation permission.

### Explicit app-data representation v2 (fixture implementation)

`inspect-app --source austin --item CATALOG_APP_ID --archive ABSOLUTE_PRIVATE_DIRECTORY --catalog-terms-sha256 CATALOG_TERMS_SHA256 --terms-sha256 ITEM_TERMS_SHA256 --app-data-format json-or-empty-v2` opts into mode `app-metadata-v2`, receiptVersion2 and an immutable format discriminator. Omission remains genuine strict-JSON v1; there is no upgrade/adoption of old failed or pending data. The flag is invalid on other commands/sources and v2 requires zero retries. Existing published app/catalog identity and reviewed distinct terms remain prerequisites.

Only app-data may produce `outcome: raw-empty`, `representation: empty-body`. This requires an actual completed fresh HTTP200 transfer, accepted explicit zero framing (Content-Length0 or properly terminated chunked), bounded supported media/headers, no credentials/challenge/redirect indicators or ambiguous encoding, then an exact successful producer/ready canonical body with zero bytes and empty-body hash. Headers remain private but are hash-bound to the producer receipt. Nonempty bytes retain strict JSON parsing without trimming; JSON null/string-empty/object-empty/array-empty are representation `json`, never raw-empty. A nonempty retained Portal policy is a conservative v2 prerequisite; provider/legacy policy handling is unchanged. No reference traversal, endpoint-availability success, wrapper absence, features or files are inferred.

For inspect-app and app-bearing verification, a consumer pre-open read-only gate snapshots main database plus WAL bytes, validates checksum/salt/committed frames within64MiB-per-file bounds, and queries a read-only in-memory SQLite view. It never connects SQLite to those source files, creates SHM, recovers/promotes a body, changes a gate, or writes source schema. Missing/inconsistent metadata, unsupported/incomplete WAL snapshots, manual holds and owned locks fail closed. Snapshot reads are not a substitute for later normal locked/runtime checks; concurrent state can still change and remains subject to those checks. Already-open inspectApp callers receive a no-further-mutation preflight, not a promise that their caller never opened a writer.

Successful v2 replay requires coherent mode/version/source/format/summary, actual ready body and exact successful producing attempt including status/error/bytes and private-header hash. Missing or conflicting markers do not fall back to v1. Hashes are not signatures against wholesale evidence reconstruction. The actual held source root is not admitted or repaired by this feature. An old v1 pending0/error is not EOF, a raw-empty receipt or wrapper absence. Native tests use local authored servers and separately named copied inputs only; no live traffic is authorized.
