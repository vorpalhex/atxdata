# CivicClerk consumer

Bun/SQLite client for public CivicClerk event metadata and published PDFs. Default tenant: Travis County. No account/API key is required for the verified endpoints. This is not a complete county archive.

## Commands

From this program directory, install locked dependencies and run local tests:

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run src/cli.ts list-meetings --from 2021-01-05 --to 2021-01-05
```

Dates are inclusive UTC calendar dates, not a conversion of the meeting's local timezone. Listing prints normalized event JSON. OData queries request `$top=25` and `$count=true`, default to a 20-request work budget (raise it with `--max-pages`), retain the original date/publication filters on every page, and reject changed bounds, duplicates, out-of-range records, cycles, oversized pages and inconsistent counts when supplied. Missing counts do not establish completeness. Continuations must target the exact same-origin `Events` collection (never event detail, file/media streams or actions). Only the unchanged `$filter`/`$top`/`$count` and exactly one `$skip` or `$skiptoken` are allowed; duplicate/extra query keys, credentials, fragments, traversal and encoded paths are refused before transport. Offsets must be canonical safe integer advances; opaque tokens must be nonblank, control-free and at most 4096 characters. Relative, query-only and same-origin absolute collection links are supported by fixtures, not a new live pagination observation.

For the existing CLI's full supported-PDF selection, set `CIVICCLERK_ARCHIVE_ROOT` to an operator-approved private archive outside the checkout, then run:

```sh
bun run src/cli.ts ingest-meeting --event-id 59 --output "$CIVICCLERK_ARCHIVE_ROOT"
```

That selects published types 1 (agenda), 2 (packet), 4 (minutes), and 5 (transcript), subject to a 12 MiB combined byte ceiling and 100-document ceiling. Raise either bound through the shipped CLI with `--max-bytes N` and `--max-documents N`. `--file-types 1,4` explicitly selects a subset; omission selects all four supported PDF classes, not a small verification subset. IDs and dates are not pinned to the examples. These are per-invocation budgets, not lifetime archive quotas. Both library budgets must be finite safe nonnegative integers: NaN, infinities, negatives, fractions and unsafe integers reject before locks, discovery or filesystem writes, including cached/offline invocations. Defaults are applied once at that public boundary and snapshotted across asynchronous work. Zero permits an empty selected-file set only; nonempty selections fail without requesting a PDF, and cached/pending bytes cannot be promoted over the remaining budget. A too-small finite quota fails the run but preserves valid download checkpoints, so a later adequate offline quota can reuse/recover them without HTTP. It is NOT the two-document verification command below. Unknown types and media are not downloaded: a successful result adds `unsupportedFiles` containing every unsupported published file identity when present. Explicit unsupported type selections reject before archive work. A selected known class returning non-PDF content fails PDF validation rather than being silently skipped. Otherwise output remains `{downloaded,skipped}`; failures exit nonzero.

For bounded sampling and offline verification, use the same client library. Set the archive variable first. This exact invocation was exercised offline against the verified sample; omit `OFFLINE=1` only for an explicitly authorized new acquisition:

```sh
OFFLINE=1 bun -e '
import { CivicClerkClient } from "./src/client";
import { PoliteHttpClient } from "./src/http";
const api = new CivicClerkClient(new PoliteHttpClient({ minIntervalMs: 2200, maxRetries: 0 }));
console.log(await api.downloadEvent(59, process.env.CIVICCLERK_ARCHIVE_ROOT ?? "", {
  fileTypes: [1, 4], maxDocuments: 2, maxBytes: 12 * 1024 * 1024,
  expectedDate: "2021-01-05", offline: process.env.OFFLINE === "1"
}));'
```

`expectedDate` checks metadata before any PDF transfer. `offline` reads SQLite's latest normalized event snapshot, validates it and checks local PDFs without any HTTP, including discovery. It cannot discover new files or remote changes. A normal rerun refreshes event metadata but skips checksum-matching PDFs; it does not revalidate a same-ID/same-name PDF against a changed remote body.

## Bounded listing and durable continuation

The legacy `listEvents(from,to)` array API is preserved; its optional third argument `{maxPages}` raises the finite work budget. It never returns a truncated array as success. CLI `list-meetings --max-pages N` has the same complete-or-error behavior.

For bounded batches, use the new `listEventsPage(from,to,{maxPages,continuation})` API or persist native CLI batches outside the checkout:

```sh
bun run src/cli.ts list-meetings --from "$FROM" --to "$TO" --max-pages "$PAGE_BUDGET" --checkpoint "$PRIVATE_OUTPUT/batch-1.json"
bun run src/cli.ts list-meetings --from "$FROM" --to "$TO" --max-pages "$PAGE_BUDGET" --resume "$PRIVATE_OUTPUT/batch-1.json" --checkpoint "$PRIVATE_OUTPUT/batch-2.json"
```

Each batch file is exclusively created with private mode, synced, and never overwritten. It contains that batch's `events`, a `complete` flag and, only when incomplete, a `continuation`. Resume requires identical tenant/date/query bounds and a new output file; completed checkpoints cannot resume. Prior batches retain their records; concatenate batch event arrays in order. IDs and visited URLs grow with traversal history to detect cross-batch duplicate IDs/cycles; event bodies are held only for the bounded current batch. A failed/interrupted batch can leave an empty or invalid output: preserve it and retry from the last valid prior batch into a new path. No automatic lock stealing or history deletion is involved.

The continuation revalidates same-origin collection paths, allowed query keys, unchanged filters, forward offsets/tokens and cumulative counts before transport; it is operator-owned local state, not an authenticated remote snapshot. `complete` means the supplied continuation chain ended and any supplied count matched, not proof that unpublished/unsupported records exist nowhere else. Remote changes between batches are not a snapshot guarantee. A local authored 23-page fixture completed both with a raised budget and across native CLI 20+3 batches. A native CLI authored 13 MiB packet succeeded with a raised byte limit. These are offline contract tests, not newly acquired county records.

## HTTP contract

`PoliteHttpClient` serializes discovery and complete body consumption, not just headers. Default pacing is 2 seconds after each completed attempt; use at least 2 seconds or a stricter published limit for live acquisition. Lower injected timing values are for local fixtures only. The queue/cooldown is per instance; do not run other source probes concurrently. An archive-wide exclusive lock prevents overlapping ingestions before discovery. Listing alone has no cross-process lock.

Redirects are manual and fail without following. Default retries are zero. Optional `HTTP_MAX_RETRIES` explicitly enables bounded transient retries; each emits an attempt number to stderr without a source URL. Backoff is exponential (500 ms base, 30-second cap, up to 250 ms jitter). The longest backoff, pacing and server cooldown wins. Retry-After seconds/dates, exhausted standard/legacy rate-limit headers and structured RateLimit instructions are honored even on successful responses and are never capped. The default 180-second timeout includes body consumption. HTTP 408/409/425/429/5xx and recognized transport failures may retry; other statuses and content-validation failures stop. Denial/challenge responses are not permission to find a bypass.

Optional settings: `CIVICCLERK_API_BASE`, `HTTP_TIMEOUT_MS`, `HTTP_MIN_INTERVAL_MS`, `HTTP_USER_AGENT`, `HTTP_MAX_RETRIES`. Another tenant needs a separate archive. Preserve the default tenant for Travis County; do not reuse downloaded access material or enumerate broad history.

## Storage and recovery

Archives must use normalized absolute non-root paths (no trailing slash, dot segments or symlink ancestors). SQLite, event directories, PDFs, partials and database sidecars reject symlinks. Use a trusted local filesystem and private permissions/umask; this is not a sandbox against a malicious process changing paths concurrently. The client does not persist HTTP headers. Any operator-recorded headers must also remain private, regular, exclusively created files.

`civicclerk.sqlite` uses WAL and foreign keys. `archive_settings` binds the tenant; `meetings`, `documents` and `ingest_runs` record identities/current status. `event_snapshots` retains distinct normalized metadata versions keyed by SHA-256 and their latest observation times, not raw responses. `document_versions` retains checksum/size/source/filename observations when downloads are checkpointed; old non-null checkpoints are migrated on opening. Raw metadata fields discarded by normalization are not promised as archived client metadata. JSON stdout is not persistence; legacy JSON manifests remain untouched.

The shared Legistar streaming/checksum helper writes `.part` to `.pending`. The CivicClerk layer bounds bytes and validates PDF content type and `%PDF-` signature before checkpointing and promoting with an atomic no-clobber hard link. PDF syntax, meeting identity and content dates still need a parser/content check; a signature is not a semantic guarantee. Failed validation propagates to failed document/run status without a final PDF. SQLite records a valid pending checksum before promotion, allowing an interrupted promotion to recover offline without a repeated PDF request.

A matching local checkpoint skips downloading. Existing mismatched/uncheckpointed final files or orphan partials are NEVER silently overwritten. Preserve/quarantine and investigate them; only an operator's explicit removal enables a full-file restart. There is no HTTP range resume. A crashed process can leave a lock containing PID/token/start time and a `running` run; neither is silently reclaimed or relabeled. Confirm that exact owner has exited before removing its stale lock, preserve the unfinished run as evidence, then rerun. A matching `.pending` is promoted; uncheckpointed partials require operator action. These are process-interruption safeguards, not power-loss or network-filesystem durability guarantees.

## Verified coverage and limitations

On 2026-11-04, one January 5, 2021 Commissioners Court Voting Session (event 59) was verified. A bounded day listing returned count 1, one unique event and no next link. Two PDFs were actually acquired, parsed, checksum-checked and retained privately: agenda file 157 (263461 bytes, 5 pages) and minutes file 3733 (138403 bytes, 8 pages); combined 401864 bytes. Both identify Travis County/Commissioners Court and January 5, 2021. qpdf reported agenda linearization/hint-table warnings (exit 3); minutes passed (exit 0). Original bytes are unchanged. Five source calls were observed in total: four traced client calls plus one preceding event-detail curl discovery. Actual serial trace peak was 1, with 2204/2202/2201 ms gaps after complete bodies. The later budget/continuation fixes used only local fixtures and retained private byte copies, with no new public requests or PDF downloads. Offline reruns skipped both with zero HTTP; SQLite integrity and foreign keys passed. Fixtures exercise actual process exit after checkpoint, stale-lock-controlled recovery, interruption, corruption/no-clobber, path/symlink safety, bounds and cooldown behavior.

The event response advertised four published PDF identities, `agendaId=59`, `hasAgenda=true`, `hasMedia=true`, on-demand media and a nonempty media-stream field. Packet/transcript were discovered but NOT acquired in this observation. No item/vote collections were present in the event response. Agenda-item/vote APIs and media availability/content remain unverified; flags/paths are not proof of playable video, and no media was requested. The normalizer currently retains only event ID/name/date and published file IDs/types/names. Structured item/vote/video ingestion is not implemented. Legacy archives, County Code and the message board are separate systems; see the county access skill's standalone CivicClerk reference for the supervised acquisition procedure.

Resume integrity: a supplied resume must be a non-null JSON object with complete=false and a valid continuation before a new output is reserved. Numeric $skip must exactly match cumulative raw ID history before every live request as well as resumed requests; stored history URLs also use the continuation query allowlist. Opaque $skiptoken values remain opaque. Singleton CLI flags may not be repeated. Offline metadata reads verify SHA256 of the exact stored JSON before parsing (existing snapshot format is unchanged).

## CLI frontend contract (initial package version 0.1.0)

`bun run src/cli.ts --help`, `-h`, `--version`, `help COMMAND`, and each
command's `-h`/`--help` are offline: no archive, configuration validation or
transport initialization. Plain invocation intentionally retains status 1 and the
stderr `{error}` usage envelope; use `--help` for the introduction. Expected usage
and runtime failures retain status 1 with that JSON envelope, without a stack.

Options use split or GNU equals values and may surround the command. Operational
singleton options reject repeats (including numeric options); informational
help/version flags may repeat. File type entries
within one value deduplicate. IDs are canonical positive safe integers; work
limits retain their documented nonnegative compatibility (page budget must be
positive). `--` ends application option parsing; subsequent operands are not help
or command selectors. Bun's launcher consumes its own first `--`, so pass another
when forwarding an application delimiter, e.g. `bun run src/cli.ts list-meetings
-- -- --help` rejects a protected extra operand rather than displaying help.
Help-like required values are not informational flags. Unknown options and
ambiguous split values reject before help; no raw argument scanning is used.

Successful JSON bytes/schemas are unchanged. Native stdout writes are checked,
including help, listing, page/checkpoint delivery and ingestion results. EBADF,
ENOSPC and other non-EPIPE failures return status 1 with a safe stdout diagnostic.
Backpressure has a five-second per-record delivery deadline. EPIPE (an early
consumer close) is intentionally quiet and does not change the domain status.
Neither output failure nor EPIPE removes completed acquisition/checkpoint facts;
JSON stdout is not persistence. Checkpoints remain private, synced and no-clobber.
No prompts, pager, color, stdin archive stream or new remote-recovery guarantees
are introduced.

For isolated offline tests, set `TMPDIR` to an existing private directory outside
all checkouts; `MEETINGS_EVIDENCE` may point to the same directory. Set `DATA_PATH`
to separate private fixture state for the shared Legistar helper tests. Run `bun
test` and `bun run typecheck` with locked dependencies and OS networking denied
except loopback for authored fixtures. No retained source input is needed by
these suites. Do not run examples against public services without authorization.
