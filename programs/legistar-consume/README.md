# legistar-consume

Bun CLI job system for downloading public Austin Legistar meeting documents to local disk.

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

