# legistar-consume cleanup report

## Verified results

All checks were run from this program directory, without live Legistar requests or importing existing data.

| Check | Before | After |
| --- | --- | --- |
| Tests | 5 passing | 134 passing, 0 failing; 413 assertions |
| TypeScript | Passing | Passing |
| Highest function CRAP | 420 | 8 |
| Functions at CRAP 10 or higher | 19 of 51 | 0 of 81 |
| Mutation sites killed | 21 | 163 |
| Mutation sites surviving | 28 | 13 |
| Mutation sites uncovered | 149 | 0 |
| Mutation score | 42.9% | 92.6% |
| Current mutation sites | 198 | 176 |
| Dryer candidates at similarity >= 0.8 | 0 | 1 reviewed structural false positive |

Function/site counts change because responsibilities were extracted and handwritten branching was removed; these are not identical mutant populations. The CRAP threshold was additionally checked with `crapper --use-existing-coverage --threshold 9.9999 src` and by aggregating every score in the snapshot.

Bun reports 100% line coverage and 98.89% function coverage for the ten source files loaded in-process by tests. The CLI is exercised by subprocess tests, not counted in that LCOV summary. Types-only declarations and the live API diagnostic script are not executable coverage targets. High line coverage does not imply mutation completeness.

uml-viewer's TypeScript parser generated `.metrics/architecture.edn`: 12 source modules and 26 dependency edges. The source-file set matches every `.ts` file under `src/`. The policy is `docs/architecture.policy.edn`. The Grok-specific GUI/agent companion was not launched or integrated.

## Changes and reasons

- Fixed CLI integer parsing: values such as `12garbage`, fractional counts, zero, negative values, and unsafe integers no longer silently truncate or reach ingestion. Seven CLI regression cases failed before the fix.
- Validated numeric configuration before filesystem effects; respected all explicit overrides, including `runsPath`, and preserved legitimate zero retry/delay values.
- Corrected HTTP header merging for `Headers`, tuples, and case-insensitive caller overrides. Kept timeouts active through response consumption, released discarded responses, and separated request/retry policy into testable operations.
- Protected reserved structured-log fields from accidental replacement by event metadata.
- Fixed backfill falsely succeeding when a child metadata request failed without a failed download. Corrected overridden output paths in persisted and returned summaries. Both regressions failed before their fixes.
- Centralized API item normalization for jobs/listing and replaced repeated meeting-document literals with one typed document description list.
- Split storage-path selection into extension and document-location responsibilities. Normal folder naming remains compatible; malformed disposition names, unsafe path segments/extensions, and case-sensitive media-type bugs are handled.
- Replaced the fragile manual write/backpressure loop with a hashing pipeline and cancellable Web-to-Node stream bridge. Tested source errors, destination errors, exact header-selected `.part` cleanup, response cancellation, large streams, digests, reruns, and missing-file recovery.
- Added real SQLite characterization tests before replacing `any` row conversion with an explicit storage boundary type.
- Removed unused `cheerio` and refreshed the Bun lockfile. Frozen-lockfile installation succeeds.
- Added reproducible quality commands and ignored generated coverage, metrics, worker output, and Clojure caches. Removed the README's workstation-specific instruction to write downloads into the monorepo root and clearly labeled historical smoke results as non-verification of this port.

## Remaining tool findings

The mutation tool still exits 3. This report does not claim a zero-survivor gate.

Reviewed surviving sites, using the final source line numbers:

| Location | Mutation | Review |
| --- | --- | --- |
| downloader.ts:30 | `??` to `||` | Byte-size zero uses fallback zero either way. |
| downloader.ts:173 and :176 | `??` to `||` | Null/empty header handling uses the same empty-string fallback. |
| downloader.ts:177 | Remove second optional access | A successful regex match always has its nonempty capture group. |
| downloader.ts:69 | Remove null guard | Successful upsert precedes the lookup. Retained defensively; concurrent external database deletion is not tested. |
| downloader.ts:203 | `force: true` to false | Missing-file removal errors are intentionally swallowed by best-effort cleanup. |
| jobs/ingest.ts:84 | `??` to `||` | Distinguishable with direct zero-concurrency API input and a different configured default; CLI/config boundaries reject zero. Not proven equivalent for unsupported direct callers. |
| api-client.ts:102 | `??` to `||` | Valid attachment arrays are truthy, including empty arrays. |
| http.ts:106 | `??` to `||` | Every valid redirect enum value is nonempty. |
| http.ts:59 | `once: true` to false | Explicit cleanup removes the listener during abort/completion/cancel. |
| strings.ts:30 | `??` to `||` | Empty-string fallback is identical for valid inputs. |
| strings.ts:31 | `??` to `||` | All extension-map values are nonempty strings. |
| strings.ts:2 | `??` to `||` | Null and empty input both reach the same cleaned fallback. |

These are review dispositions, not suppressions or fabricated kills. Raw form counters and command logs were retained privately, outside the publication tree. Historical `:outcomes` keys can remain after refactors, so counting that history would overstate the current population.

Dryer reports similarity 1.0 between `eventPublication` and `itemMatter` in `src/legistar/api-client.ts` (lines 153–162 and 181–190). Both are six-field null-defaulting object maps, but map different domain concepts and source types. Kept explicit rather than adding generic transformation machinery solely to evade structural fingerprints. Actual duplicated item normalization and document descriptors were removed.

## Limits and deferred work

- `retry-failed` remains explicitly unimplemented; scraper fallback, Docker packaging, and overlapping-job locking are not added by this cleanup.
- No live-service smoke ingestion was performed during the offline cleanup. A subsequent live run downloaded the October 8 and October 22, 2026 meetings: 244 documents with verified sizes and SHA-256 hashes. Those original records and the runtime database are archived privately, not published.
- Existing concurrent output-path collisions and URL-global document identity semantics remain unchanged.
- Caller abort during retry backoff is checked before the next request, not used to interrupt the sleep. Body-read errors are surfaced rather than replaying partially consumed transfers.
- Cleanup and sanitization did not create commits or publish the repository.
- Runtime data, generated reports, dependency installs, and test scratch state are excluded from the publication tree. Mutation worker overlays were cleaned up.

## Action log and artifacts

Raw baseline/final snapshots, command logs, and detailed workstream action logs were archived privately and removed from the repository before publication. This report and `docs/architecture.policy.edn` are the portable record. The quality commands in the README regenerate local reports in ignored directories; review/redact them separately before sharing.

## Domain glossary

- Meeting/event: a Legistar event and its meeting-level documents.
- Agenda item: a numbered item within an event, optionally linked to a matter.
- Matter: the underlying legislative record; attachments are its public files or links.
- Manifest: ordered downloadable document descriptions, deduplicated by exact source URL.
- Required document: a failed download that fails a meeting; optional failures remain visible in summaries.
- Run: a persisted meeting/backfill job plus its JSON summary.
- Checkpoint: the latest processed meeting recorded during a backfill, not a resume scheduler.
