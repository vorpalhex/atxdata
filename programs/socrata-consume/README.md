# socrata-consume

Bun/SQLite collector for explicitly selected, public tabular Austin Socrata datasets. eCheckbook (`8c6z-qnmj`) is a convenience preset, not an asset allowlist. Other compatible datasets are selected through retained Austin catalog membership and schema. This program does not authenticate, register identities, acquire tokens, mutate the publisher, enrich people, or enumerate all city holdings.

## Austin source families

[SOURCE-FAMILIES.md](SOURCE-FAMILIES.md) lists evidenced spending, procurement,
campaign-finance, lobbying and other source IDs, their different record grains,
and unresolved coverage boundaries. These are ordinary asset operands, not a new
allowlist. Catalog/schema inspection is not proof that a dataset's rows have been
acquired or its entire history is available.

## Source identity and old archives

The canonical publisher and catalog authority is `https://datahub.austintexas.gov`; catalog queries filter that exact domain. Published catalog links must use that authority and name the matching asset. Source and catalog share one retained robots observation, without a separate api.us policy dependency. Asset IDs are preserved literally.

Fresh operations use `socrata-v2-datahub`. Earlier `socrata-v1` archives used the old publisher/catalog identity and are unsupported by this initial candidate: status, verification and collection reject with `unsupported old source identity; reviewed migration required` before opening writers or making requests. No automatic migration or rewriting of original URLs, options, bodies or aliases is performed. Preserve the old archive for explicit operator review; do not clear cooldowns or create another archive to evade an unresolved request. This is a deliberate version boundary, not a claim that retained old observations came from the new authority.

## Run

Requires Bun 1.3.14 or a compatible later Bun runtime. Install the exact dependencies from this program directory:

    bun install --frozen-lockfile
    bun src/cli.ts --help

From elsewhere, invoke the same entrypoint by its path. Commands never prompt. Every operation requires `--archive` naming a canonical absolute private directory outside the checkout. Use ONE designated archive for this Austin source across datasets; different archives do not coordinate rate limits. Keep raw archives, query selections, logs and row values private.

    bun src/cli.ts discover --query payments --limit 20 --archive <private-archive> --json
    bun src/cli.ts inspect 8c6z-qnmj --archive <private-archive> --json
    bun src/cli.ts collect --preset echeckbook --where "fiscal_year = '2025'" --max-rows 100000 --archive <private-archive> --json
    bun src/cli.ts status --archive <private-archive> --json
    bun src/cli.ts verify --archive <private-archive> --json

The WHERE example illustrates syntax only. First inspect the actual retained schema and choose a published field and value; no fiscal/date field or coverage is inferred. Arbitrary SoQL WHERE expressions are passed as one encoded parameter, retained exactly, and applied identically to count and row queries. No projection/filtering is performed locally. A direct asset operand can replace `--preset echeckbook`.

`discover` performs one bounded catalog search page. It reports its offset, publisher result count as a decimal string, and `catalogComplete`; it does not silently crawl the catalog. `inspect` retains the matching catalog record and full source metadata; its columns are a projection, and raw metadata is retained.

`collect` counts the selected query BEFORE row requests. If count exceeds `--max-rows`, it fails and advises narrowing the WHERE expression or raising the bound; it never certifies a truncated prefix. `--max-rows` is required even for a preset. Full-asset acquisition is supported with sufficient explicit bounds; it is not the default permission for a large download. The operator owns privacy approval and live-request authorization per selection.

## Coverage and values

Requests use `$select=*, :id`, `$order=:id`, explicit `$limit` and `$offset`. Star must come first in the select list; the publisher rejects `:id,*`. Offset advances by actual returned raw rows, including a server-imposed smaller page cap. A nonempty page cannot exceed its requested limit, duplicate row IDs fail, and a final empty page at the reconciled selected count is required. Before/after metadata revision and count must match. A resumed traversal checks them again before continuing.

`status: complete` means the selected traversal reconciled, NOT a transactional snapshot or complete historical coverage. `wholeAsset` describes absence of a WHERE filter, not all publisher history. `transactionalSnapshot` is always false. Unchanged count, schema and update markers cannot detect every concurrent in-place edit; this is a mutable observation, including across resume.

`data.sqlite` stores snapshot selection/status, page references, and one source row per ordinal. `source_id` is an opaque string. `source_json` is the exact original JSON object substring. `value_json` preserves JSON number tokens as exact strings (including scale, exponents and negative zero), while keeping source strings, booleans, null, absent properties and nested structures distinct. It does not normalize money, dates, locations or domain semantics. Duplicate JSON keys, missing/non-string row IDs, invalid UTF-8, non-tabular metadata and unsupported response shapes fail closed. This does not claim compatibility with every Socrata view or system-field version.

## Original representation and provenance

`transport/state.sqlite` and body files are owned by the existing shared Archive/Store provider. The Socrata adapter uses its text seam rather than its object-only JSON decoder. Before semantic parsing it independently checks original retained bytes using fatal UTF-8 decoding. Both SQLite databases remain independent; no sibling provider tables are changed.

Body originals are the exact response-body bytes exposed by fetch, which may already be decompressed by Bun. They are NOT TLS packets, transfer framing, or compressed wire captures. `representation: fetch-decoded-body` is persisted in versioned operation options. Original HTTP status/headers remain in the attempt ledger; an encoded Content-Length can therefore differ from the retained decoded-body length. Byte ceilings and hashes apply to consumed decoded body bytes. HTTP error bodies canceled by the shared provider are not archived or counted as downloaded originals; status/header/timing facts remain. Wire-byte accounting and power-loss durability are not claimed.

Successful originals are immutable, private, SHA-256-checked files. Failed/pending bytes are retained privately where the provider leaves them. Rows, source identity, exact URLs/filter/order, options, producer attempts and before/after metadata are revalidated offline, not trusted merely because SQLite integrity and hashes pass. This detects inconsistent/corrupted evidence; it is not cryptographic authentication against an actor rewriting the entire archive.

## Budgets, resume and refresh

Defaults are finite and support ordinary datasets rather than a proof-sample whitelist:

    --page-size 10000
    --max-requests 10000
    --response-bytes 20000000
    --total-bytes 2000000000
    --timeout-ms 45000

`--max-rows` has no default. Integer options reject zero, negative, fractional, unsafe and trailing-junk values. Flags take precedence over defaults; no environment/project configuration or secrets are loaded. Options may precede or follow commands; repeated options use Commander's last-value-wins behavior. `--` stops option parsing in its scope. There are no abbreviated options or prompts. There are no retries hidden behind the parser or HTTP provider.

Successful repeated collection reuses verified retained state with zero requests. Current row/per-response ceilings still apply to reuse; aggregate acquisition budgets spend zero new body bytes on reuse. `--refresh` retains a NEW observation/version, preserving old pages and partials. It never clears unknown-transfer or damaged-policy stops.

After a definite HTTP429 or an interruption between settled pages, repeat the exact selection and bounds with `--resume`. Retained pages are verified and not fetched again. The provider's original run attempt/aggregate ceilings are frozen: resume cannot raise them. A different page size/row bound requires explicit refresh. A changed source revision/count cannot be continued as the old traversal. A body checkpoint not yet indexed is reprocessed from its verified original. Offline verify does not promote pending files; request-side recovery may promote only a checksum-matching pending original using no-clobber links.

A process crash may leave the exclusive lock or an unknown request. Locks are never stolen automatically. Confirm the producing process is dead and inspect retained request/timing evidence before operator recovery; do not delete locks, reset gates, invent transfer completion, or use a fresh archive to evade an unknown outcome. Unknown dispatched/incomplete-body outcomes require manual review. Process-crash recovery is narrower than a power-loss guarantee.

## Policy and CLI contracts

All source requests, including robots, catalog, schema, counts and pages, are serial full-body operations. Persisted minimum spacing is at least 3 seconds or the stricter robots/server instruction. Successful responses and HTTP429 both preserve cooldowns across restart. Lowered gates, missing policy/timing tables, malformed versions, source derivation faults and orphan evidence reject before recovery/schema writes or new traffic. Robots Disallow is honored; challenges and malformed crawl delays stop acquisition. No redirects or automatic source retries are followed.

One process can own only one Socrata source session at a time. Private creation uses a scoped process umask of 077 while that owner is open, restored on close. Do not run unrelated concurrent file-creation code in that process. Cross-process ownership is an exclusive file lock. Untrusted writers racing within the private archive are not a supported threat model.

Results/help/version use stdout; diagnostics use stderr. `--json` emits one compact JSON object, never progress mixed into data. Human mode emits readable JSON with identical values. No color, pager, telemetry or browser launches. Exit 0 is delivered success/information, exit 1 is parse/acquisition/verification/delivery failure. Partial work is retained and is not reported complete. Downstream EPIPE is quiet success; other output errors fail. Output delivery has a bounded timeout. SIGINT/SIGTERM may leave safe conservative locks/reservations requiring review rather than silently granting another request.

## Tests and acceptance limits

Set `SOCRATA_TEST_ROOT` to an existing private external fixture directory, then run:

    bun test
    bun run typecheck

Tests use authored responses and a loopback HTTP service; subprocess tests invoke the shipped Commander entrypoint. A test-only preload injects loopback routing and a labelled clock; there is no production fixture-origin flag or public-network bypass. Run the suite under an OS public-network-denial boundary when publisher traffic is not authorized. Authored scale tests exercise a second asset and more than twenty thousand rows; they do not establish live source completeness or throughput. Independent frozen-source review and separately authorized live CLI acquisition remain acceptance gates outside the authored suite.

Protocol references: https://dev.socrata.com/docs/system-fields.html and https://dev.socrata.com/docs/datatypes/number.html. New SODA3/token/POST query APIs are outside this anonymous SODA resource-GET implementation.
