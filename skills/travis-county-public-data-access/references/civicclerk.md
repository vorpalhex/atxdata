# Travis County CivicClerk: bounded client acquisition

## Scope and prerequisites

Use `programs/civicclerk-consume` from the repository root, not a replacement downloader. Bun and its locked dependencies are required; Poppler (`pdfinfo`, `pdftotext`) and qpdf supply offline content checks. No account or API key was used. Official surfaces are https://traviscotx.portal.civicclerk.com/ and https://traviscotx.api.civicclerk.com/v1/ .

Keep one approved dated event, at most two small published PDFs and a 12 MiB combined budget for the initial verification. Broader backfills require a separate explicit scope. This procedure covers public event/PDF access only: legacy minutes archives, County Code and the Court message board have separate references and collectors/workflows.

Before source traffic, read the client's actual code/tests/schema/README and exercise its serial queue locally. Run from the program directory:

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
```

Tests use injected responses and loopback fixtures; these do not establish live access by themselves. Set the process temporary directory to an approved private scratch destination before tests. On macOS, choose a physical path without symlink ancestors; the archive intentionally rejects system aliases as well as operator-created symlinks.

## Private archive and acquisition gates

1. Obtain an approved private archive destination outside the publishable checkout. Set `CIVICCLERK_ARCHIVE_ROOT` to its normalized absolute, non-root physical path. Use private directory permissions and umask. Raw responses, PDFs, text extraction, SQLite, traces, request/response headers and any media/access links stay there or in source-specific private evidence storage. Never print whole metadata responses to shared logs.
2. Use one source request at a time, including discovery and full body consumption. Use at least two seconds after completion or the stricter publisher limit. Honor Retry-After/cooldown headers even on success. Ordinary browser navigation can fan out concurrent requests and is not compliant acquisition evidence. Do not probe alongside an active ingestion.
3. When curl is used, `--disable` must be its first argument. Disable redirects/retries, set explicit time/size limits, exclusively reserve all body/header destinations, reject symlinks for their ancestors and files, retain status/provenance privately and consume the entire accepted response. A header-only probe or shell-page HTTP 200 is not acquisition. Read all cooldown headers before another request. No challenge bypass, alternate denied-export route, account registration or records request is authorized.
4. The client itself now defaults to manual redirects, zero retries and a two-second gap. Explicit bounded transient retries are logged by attempt number and use exponential jitter; permanent errors, denied exports and invalid content stop. Do not enable retries to reinterpret a source denial as transient access. The queue is per instance; archive locks do not serialize separate list commands or separate archives.
5. Start from one bounded day, not the historical collection. The verified day is `2021-01-05`, event `59`. `list-meetings --from 2021-01-05 --to 2021-01-05` requests published events with `$top=25` and `$count=true`. Inspect schema/identity/count privately. Client checks dates, unique positive IDs, page limits, unchanged filter and optional counts, and rejects unsafe/cyclic pagination. Continuations are restricted to the exact same-origin `Events` collection path and unchanged fixed bounds, plus exactly one safe advancing `$skip` or opaque `$skiptoken` (nonblank, control-free, at most 4096 characters). Extra/duplicate query keys, file/media/detail/action endpoints, credentials, fragments, traversal and encoded paths reject before any transport. Relative/query-only/same-origin absolute continuations were verified with fixtures only. Missing count fields and single-page samples do not prove multi-page service correctness.
6. Use the README's bounded library call with `fileTypes:[1,4]`, `maxDocuments:2`, `maxBytes:12*1024*1024`, `expectedDate:"2021-01-05"`, and `maxRetries:0`. Do not use the CLI's all-types ingestion for this initial scope. The library verifies returned event ID/date before PDF transfers. Only file IDs from the accepted event response are used; file stream URLs are computed under the same tenant API base. Numeric budgets are validated once as finite safe nonnegative integers before any lock, discovery or archive write, including cached/offline calls. Omitted defaults remain 100 selected documents and 12 MiB. Zero permits only an empty selected-file set; pending/cached bytes above the remaining budget are refused before promotion. An undersized finite quota fails the run without invalidating a valid checkpoint; an adequate offline rerun can then recover without HTTP.

## Validation and provenance

The verified route is `Events/59`; published files use `Meetings/GetMeetingFileStream(fileId=ID,plainText=false)`. Do not substitute the previously unsuccessful event-file route or guess item/vote endpoints.

Keep observation time, tenant, exact bounded query, event ID/name/date, source response hash, published file IDs/types/names, and each final PDF's source URL/bytes/SHA-256. Preserve publisher timestamps/version fields separately when the raw response supplies them; meeting date, observation time and publication time are not interchangeable. PDF SHA-256 is a byte-version identity, not a publisher-issued release number. The client stores normalized event snapshots and document-version checksums in SQLite; it does not preserve all raw metadata fields or headers.

Before acceptance:

- Require successful PDF content type, `%PDF-` signature and streaming byte ceiling, not a filename alone. Invalid body/size responses must fail the run without promotion.
- Parse every acquired PDF using `pdfinfo` and `pdftotext`; verify Court/body/date/role against the selected event, inspect warnings and retain original bytes. If parsing is empty/unreliable, render privately and inspect rather than claiming absent content. qpdf warnings are not a clean syntax pass. Do not turn vote text in minutes into structured vote coverage without a separate extraction/validation contract.
- Recompute local file hashes and sizes against SQLite, run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, and reconcile actual PDF count. No checksum or query identity may be invented.
- Run the same bounded library call in a new process with `offline:true`; assert zero HTTP and skipped matching PDFs. The README supplies the exact `OFFLINE=1` invocation. Ordinary reruns may refresh metadata but never refetch matching PDF checkpoints.

## Restart and refusal behavior

One archive-wide `.civicclerk.lock` is created exclusively before metadata discovery. It contains a unique token/PID/start time; release removes only the same token. Lock collisions must make no request. Never remove another active process's lock. After a crash, confirm that exact owner exited and explicitly remove only its stale lock; interrupted `running` database records remain evidence, not falsely succeeded/failed runs.

Files stream through the existing Legistar helper to a private `.part`, then `.pending`. CivicClerk validates size/signature, durably records the checksum, and promotes with a no-clobber hard link. An interrupted checkpoint-to-promotion window can recover offline from a matching `.pending`. Existing final files with mismatched checkpoints, symlinks and uncheckpointed partials are refused, not overwritten. Preserve/quarantine invalid artifacts before explicit removal and a whole-file restart; no byte-range resume or silent corrupt-file repair is promised. Do not modify stored source identities to make a bad file appear validated. These safeguards assume a trusted local filesystem and do not promise power-loss or hostile-local-race safety.

Local tests exercise path/dot-segment/ancestor symlink rejection, SQLite/file symlinks, lock collision, failed validation status propagation, byte/count boundaries, partial refusal, no-clobber corruption, serial full-body consumption, server cooldowns, broken-stream restart, offline duplicates, and an actual subprocess exit immediately after the SQLite download checkpoint. Its owner-confirmed stale-lock removal and offline recovery produce one PDF without another request. The client does not save headers; separately recorded headers must follow the same private exclusive/no-symlink discipline.

## Actual observation, 2026-11-04

One dated Commissioners Court Voting Session was acquired, not complete history:

- Day listing: `@odata.count=1`, one unique event (`59`), no next link. Event date: `2021-01-05T09:00:00Z`. This is a bounded-day reconciliation, not live multi-page pagination proof.
- Published identities: agenda `157` (type 1), packet `158` (type 2), minutes `3733` (type 4), transcript `162` (type 5). Only agenda and minutes were downloaded.
- Agenda: 263461 bytes, 5 pages, SHA-256 `8b13860219cd0b6554fdbac68ff655beb4c4fd50ba96472f0accc6b95b9eb31b`. qpdf exit 3: linearization/shared-object hint-table warnings. Poppler parsed it and its Court/date identity matched.
- Minutes: 138403 bytes, 8 pages, SHA-256 `1e19ce8abfb6a039fa19a954eb55ad149c6087d866d68c152dd115a677ae62c1`. qpdf exit 0; Poppler parsed it and its Court/date identity matched.
- Combined: 401864 bytes. The actual client/probe trace recorded four serial source requests (day listing, event detail, two PDFs), peak in-flight 1 and 2204/2202/2201 ms completion-to-start gaps. A preceding serial curl event-detail discovery was also retained privately, making FIVE total observed source calls, not four; no redirects or retries occurred. The budget/continuation follow-up used local fixtures and retained byte copies only, with no new public source requests or downloads. No cooldown instruction was observed in that initial response; synthetic success/error cooldown branches were tested locally.
- SQLite integrity was `ok`, foreign-key checks returned no violations. Separate-process offline reruns skipped both PDFs with zero requests and no duplicate outputs. Process-interruption recovery was exercised locally, not by interrupting a live server transfer.

## Richer metadata: advertised versus supported

The actual event response includes `agendaId=59`, `hasAgenda=true`, `hasMedia=true`, on-demand media flags and a nonempty media-stream field. It has no item/vote collection. This establishes advertised metadata, not that media is playable or that item/vote APIs do not exist. No media URL was followed, no video downloaded, and no item/vote route guessed. Structured agenda items, votes, speakers/timestamps, video retrieval and broader schema discovery remain unverified/unimplemented.

The normalizer retains only ID/name/date and published file IDs/types/names. Raw optional field values were inspected and retained privately but are not silently advertised as supported normalized output. Packet/transcript support exists in code and local fixtures; they were not newly acquired in this bounded observation. Same-ID/same-name remote PDF revisions are not detected by offline/checkpoint reuse; use a separately approved new archive observation if such comparison is needed. Complete history, ongoing synchronization and source completeness remain unresolved. Independent review and integration are chief-owned.
