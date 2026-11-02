# CivicClerk consumer

Minimal Bun client for public CivicClerk meeting metadata and PDFs. Defaults to Travis County; no account or API key required.

From this directory:

```sh
bun install
bun run src/cli.ts list-meetings --from 2021-01-01 --to 2021-01-31
bun run src/cli.ts ingest-meeting --event-id 59 --output data/documents
bun test
bun run typecheck
```

`list-meetings` prints a JSON array of normalized events. Dates are inclusive UTC calendar dates. `ingest-meeting` prints `{downloaded, skipped}` and writes `civicclerk.sqlite` plus PDFs in `event-59/` under the chosen output directory. Errors go to stderr with a nonzero exit code.

SQLite stores meeting metadata, document discovery/download status, and ingestion runs, using WAL and foreign keys like the Legistar client. Keys include the tenant API base and event/file identity. Each output directory is bound to one tenant; another tenant must use a separate output directory to prevent PDF filename collisions. Each completed file checkpoints its size, SHA-256, source URL, and type/file ID; failed transfers record the error and failed run. The database closes after each ingestion. Reruns verify file bytes before skipping; missing/corrupt files download again. Transfers stream through atomic `.part` files using the Legistar downloader helper. Metadata filenames and download URLs are computed locally, never taken from server paths. Only published file types 1 (agenda), 2 (packet), 4 (minutes), and 5 (transcript) are downloaded, and responses must have PDF content type. Video and unknown types are not downloaded.

Requests and full response consumption are serial through `PoliteHttpClient`. The default gap is one second after each completed attempt; three retries use exponential backoff (500 ms base, 30-second cap) plus up to 250 ms jitter. The longer of backoff, configured pacing, and server cooldown wins; server cooldowns are not capped. `Retry-After` seconds/HTTP dates, exhausted `RateLimit-Remaining`/`RateLimit-Reset`, `X-RateLimit-*` epoch resets, and structured `RateLimit` `r=0;t=...` are honored even on successful responses. Transient HTTP 408/409/425/429/5xx and connection/timeout failures retry; permanent HTTP errors fail immediately. The default 180-second timeout covers headers and body consumption. This queue is per client instance, not a cross-process limiter.

Set `CIVICCLERK_API_BASE` to another public tenant's `/v1` endpoint. Optional transport settings: `HTTP_MAX_RETRIES`, `HTTP_TIMEOUT_MS`, `HTTP_MIN_INTERVAL_MS`, and `HTTP_USER_AGENT`. Pagination stays on the configured origin and API path.

Existing JSON manifests are left untouched and are no longer read or written. The first SQLite-backed ingestion redownloads files without database checkpoints; subsequent runs resume from SQLite. CLI JSON output remains unchanged.

For library use, import `CivicClerkClient` from `src/client.ts`, inject a `PoliteHttpClient` from `src/http.ts`, and call `listEvents(from, to)`, `getEvent(id)`, or `downloadEvent(id, output)`. The constructor's optional second argument overrides the API base.

Use a trusted output directory and one writer per event. Existing event/file symlinks are rejected; this is not a sandbox against concurrent local filesystem changes. A failed transfer stops ingestion; rerun the same command to resume. No video, agenda-item expansion, bulk scheduler or account access is included. Tests use injected responses and loopback HTTP, not the live service. Downloaded records are not repository source; keep production archives outside the checkout.
