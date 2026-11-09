# legistar-consume

Bun CLI job system for downloading public Austin Legistar meeting documents to local disk.

Resume integrity: an explicitly supplied resume must be a non-null, non-array JSON object with complete=false and a valid source/query/page-size/offset/ID continuation. Invalid state is rejected before reserving output or creating HTTP transport. Outputs remain exclusive private synced direct writes, not atomic publication.

The app currently uses the unauthenticated Legistar API client key `austintexas`, writes metadata to SQLite, writes documents to a human-readable folder layout, and emits JSON logs suitable for cron.

## Requirements

- Bun
- just

Run commands from `programs/legistar-consume/` inside the monorepo. `just` is optional if you use the package scripts directly.

```bash
bun install --frozen-lockfile
```

## Common Commands

List available recipes:

```bash
just
```

Check API access:

```bash
just check-api
```

List meetings in a date range:

```bash
just list-meetings 2026-05-30 2026-08-01
```

Optionally filter by body:

```bash
just list-meetings 2026-05-21 2026-05-21 "City Council"
```

Ingest one meeting by date:

```bash
just ingest-date 2026-05-21 "City Council"
```

Ingest one meeting by API event id:

```bash
just ingest-meeting 4072
```

Backfill a date range:

```bash
just backfill 2026-05-01 2026-05-31 "City Council"
```

Run checks:

```bash
just verify
```

## Collection contract and bounded continuation

The authoritative Events documentation describes “Gets all Events” and a bare JSON array, not a `value`/`@odata.nextLink` envelope.[1] EventItems documentation exposes `AgendaNote`, `MinutesNote` and `Attachments` selectors.[2] A bounded contract check observed two one-record Events responses: `$top=1` ordered by EventId, then the same query with `$skip=1`, returned distinct EventIds 1068 and 1069.[3][4] This proves those query controls for that tiny observation, not a default server cap or a previously demonstrated live truncation defect. No public PDF or broad event history was acquired for this repair.

Event selection still accepts arbitrary date ranges, body names and event IDs. `listEvents(from,to,body?,{maxPages?,pageSize?})` preserves its array return, now fetching serial pages in stable EventId order and returning complete results or an explicit incomplete-range error. Defaults are 100 requests and requested page size 100; both are caller controls, not hard maximums. Returned arrays are date-sorted as before (missing legacy dates retain relative ordering). The shipped `list-meetings` and `backfill` commands accept `--max-pages N --page-size N`. Backfill does not start document acquisition after incomplete discovery.

A short page does NOT imply completion: a server may cap `$top`. The collector advances `$skip` by the actual raw row count, filters bodies only after advancing, and requires a terminal empty array before declaring the range complete. Ignored offsets/repeated IDs, malformed/oversized pages, out-of-range dated events and invalid budgets reject rather than silently truncate. A successful response is still a mutable source observation: deletions/insertions between offset pages can shift the collection, and the API supplies no snapshot/completeness count here. Reconcile/restart the explicit range when source changes matter.

For finite work across processes, use the new page API `listEventsPage(from,to,body?,{maxPages,pageSize,continuation})`, or the shipped CLI:

```sh
bun run src/cli.ts list-meetings-page --from "$FROM" --to "$TO" --max-pages "$PAGE_BUDGET" --page-size "$PAGE_SIZE" --checkpoint "$PRIVATE_OUTPUT/batch-1.json"
bun run src/cli.ts list-meetings-page --from "$FROM" --to "$TO" --max-pages "$PAGE_BUDGET" --page-size "$PAGE_SIZE" --resume "$PRIVATE_OUTPUT/batch-1.json" --checkpoint "$PRIVATE_OUTPUT/batch-2.json"
```

Batch JSON contains `meetings`, `complete`, and only when incomplete a `continuation`; combine meetings from each batch. Checkpoints bind the exact tenant/range/body/page-size and cumulative unique ID history; URLs are reconstructed locally, not accepted from a checkpoint. New checkpoint paths are exclusively created private files, synced and never overwritten. Preserve failed batch outputs and retry from the last valid batch into a different file. Each batch holds only bounded meeting bodies, plus cumulative ID history for duplicate detection. Legacy complete-array callers retain the full selected range in memory. Local authored fixtures cover a server cap smaller than `$top`, explicit incomplete work and native CLI process continuation. These are not claims of live multi-page completeness.

Requested agenda/minutes notes are retained, including empty strings and source markup, in optional normalized `agendaNote`/`minutesNote` fields and additive `meeting_items.agenda_note`/`minutes_note` columns. Existing databases migrate without deleting original rows or changing document/checkpoint identities. Note HTML is data, not rendered or executed. Vote and media ingestion are not implemented; documented fields/endpoints alone do not establish downloadable content.

Sources:

[1] https://webapi.legistar.com/Help/Api/GET-v1-Client-Events
[2] https://webapi.legistar.com/Help/Api/GET-v1-Client-Events-EventId-EventItems_AgendaNote_MinutesNote_Attachments
[3] https://webapi.legistar.com/v1/austintexas/events?$top=1&$orderby=EventId%20asc&$select=EventId,EventDate
[4] https://webapi.legistar.com/v1/austintexas/events?$top=1&$skip=1&$orderby=EventId%20asc&$select=EventId,EventDate

## Cron

Configure the scheduler to use this program directory as its working directory, then run `just backfill` with explicit dates and a body. Keep scheduler logs in a private runtime location; do not publish raw logs.

Backfill always requires explicit dates. It processes meetings serially, uses one download at a time, and waits 3 seconds between meetings by default.

## Configuration

Set configuration with environment variables. The `Justfile` also supports a local `.env` file for non-secret settings. Keep credentials outside the repository; this public-document downloader does not require a Legistar secret.

Defaults keep runtime output in this program's ignored `data/` directory. For a Paperless import directory, set `DOCUMENT_STORE_PATH` to your own dedicated import path, not to the monorepo root.

Defaults:

- `LEGISTAR_CLIENT=austintexas`
- `LEGISTAR_API_BASE=https://webapi.legistar.com/v1`
- `LEGISTAR_PORTAL_BASE=https://austintexas.legistar.com`
- `DATA_PATH=./data`
- `DATABASE_PATH=./data/legistar.sqlite`
- `DOCUMENT_STORE_PATH=./data/documents`
- `RUNS_PATH=./data/runs`
- `HTTP_TIMEOUT_MS=30000`
- `DOWNLOAD_CONCURRENCY_NORMAL=3`
- `DOWNLOAD_CONCURRENCY_BACKFILL=1`
- `BACKFILL_MEETING_DELAY_MS=3000`
- `MAX_DOWNLOAD_RETRIES=3`

## Output

Metadata:

```text
data/legistar.sqlite
```

Run summaries:

```text
data/runs/<run-id>.json
```

Documents:

```text
data/documents/
  city-council-meeting/
    2026-05-21/
      meeting-documents/
        agenda/
          agenda_event-4072.pdf
        agenda-packet/
          agenda-packet_event-4072.pdf
      agenda_item_1/
        matter-file-26-1806/
          attachment-documents/
            attachment-82900_recommendation-for-action.pdf
```

The directory names are intentionally Paperless-friendly tags. Meeting-level files are tagged as
the meeting type, event date, `meeting-documents`, and their document kind. Item attachments are
tagged as the meeting type, event date, the visible agenda item number, the Legistar matter file,
and `attachment-documents`.

## Offline Verification and Quality Tools

```bash
bun run typecheck
bun test
bun run coverage
bun run quality:crap
bun run quality:dry
bun run quality:mutate
```

The optional quality commands require `crapper`, `dryer`, and `mutator` on PATH; they are not runtime dependencies. Tests use isolated scratch/in-memory data and loopback HTTP, not the live Legistar service. Coverage and tool reports are ignored under `coverage/` and `.metrics/`. Mutation workers use ignored `target/`.

`quality:crap` produces measurements; inspect `.metrics/crap.edn` for the ub-mode target of every function below 10. `quality:dry` uses similarity 0.8; its exit code indicates report generation, not absence of findings. `quality:mutate` returns 3 for surviving mutants and 2 for a failing baseline. An empty execution is not proof of adequate tests.

Architecture policy: `docs/architecture.policy.edn`. The optional [uml-viewer](https://github.com/unclebob/uml-viewer) tool uses Clojure CLI and Java 21+. Install and configure its classpath according to its upstream documentation, then invoke its `uml-viewer.main.ir-generator` entry point from the program directory with `docs/architecture.policy.edn` as input and `.metrics/architecture.edn` as output. No workstation-specific tool location is assumed.

Set `JAVA_HOME` if your JDK is not discovered automatically. This generates architecture IR only; the upstream GUI companion is Grok-specific and is not automatically started.

See `docs/quality-report.md` for verified cleanup results and remaining limitations.

## Live Smoke Commands

```bash
just smoke-list
just smoke-ingest
```

These contact Legistar and may download substantial data. They were not run during the offline cleanup. Historical full-ingest results from the original repository are not verification of this port.

## Current Gaps

- scraper fallback
- `retry-failed` (currently reports an explicit not-implemented error)
- Docker packaging
- job locking to prevent overlapping cron runs
- broader live-service verification beyond the two smoke meetings

