# TNR GeoHub: bounded anonymous ArcGIS access

Verified 2026-11-04. This is a manually operated access procedure, not a new client, scheduler, or complete county GIS archive. It requires curl, Python 3 and a SHA-256 utility (`shasum -a 256` on macOS). No Bun, account, token or SQLite database is required. Operator-enforced request gates below are mandatory; the curl command alone does not implement retries, cooldowns, locking or completeness checks.

## Authority and discovery

The [county open-data directory](https://www.traviscountytx.gov/open-data-portal) links [TNR GeoHub](https://tnr-traviscountytx.hub.arcgis.com/). The hub identifies site item `2eff5d073fca4eeb97d600cda4699e46` and organization `HGcSYZ5bvjRswoCb`. Start from the current site configuration, not an organization-wide search that may include unpublished-to-hub subjects.

ArcGIS sharing base: `https://www.arcgis.com/sharing/rest`.

1. GET `/content/items/2eff5d073fca4eeb97d600cda4699e46?f=json` and the same item path with `/data?f=json`.
2. In the data response, inspect `useCatalogV2` and `catalogV2.scopes.item.filters`. At verification, one predicate selected any of nine groups:

   `9f8a8f8dc344497fa5ba23026fcf0ade`, `857aac09e31548bbb95a97c99356a6f5`, `e4410bf370a2497f8a973bd22e8fb09e`, `432b6e8921724bfe80c2d83fa2fbec6e`, `8a9852e9b5a742d59576b6cecb940d81`, `ca4fc4c6e96e47cfb8c121c4ab74b03e`, `c7316cabf7ad4ea99931af713b9ee24b`, `67625e5dfb7d48bf8500cf1cef9cd6e1`, `48e43ea2e8ec4d9c8f471d13ca88447f`.

3. GET `/search` with `f=json`, `num=100`, `start=1`, `sortField=title`, `sortOrder=asc`, and `q=(group:G1 OR group:G2 OR ... OR group:G9) AND type:"Feature Service"`, substituting the current groups. Use `--data-urlencode` for the entire `q`, not literal ellipses. The tested query returned 17 distinct item IDs, `total=17`, `nextStart=-1`; this exhausts that public search response, not every hub item type, ArcGIS service, or county holding. Search indexing and group membership can change.
For the observed configuration, the exact search arguments were:

```sh
URL='https://www.arcgis.com/sharing/rest/search'
Q='(group:9f8a8f8dc344497fa5ba23026fcf0ade OR group:857aac09e31548bbb95a97c99356a6f5 OR group:e4410bf370a2497f8a973bd22e8fb09e OR group:432b6e8921724bfe80c2d83fa2fbec6e OR group:8a9852e9b5a742d59576b6cecb940d81 OR group:ca4fc4c6e96e47cfb8c121c4ab74b03e OR group:c7316cabf7ad4ea99931af713b9ee24b OR group:67625e5dfb7d48bf8500cf1cef9cd6e1 OR group:48e43ea2e8ec4d9c8f471d13ca88447f) AND type:"Feature Service"'
set -- --data-urlencode 'f=json' --data-urlencode "q=$Q" \
  --data-urlencode 'num=100' --data-urlencode 'start=1' \
  --data-urlencode 'sortField=title' --data-urlencode 'sortOrder=asc'
```

4. Preserve each result's ID, title, URL, type, created/modified times, access, description and terms in private evidence. A Feature Service item can point to a MapServer or an already-numbered layer: inspect its actual URL, do not mechanically append `/0`. Read service metadata to enumerate layers/tables and layer metadata to learn fields and geometry. Set a new discovery budget before following more pages: at most two search pages of 100 in this procedure, serially. Stop and report partial if the next page remains, totals disagree, IDs duplicate, scope changes, or a challenge appears.

Observed catalog subjects included county/municipal boundaries, commissioner and other districts, roads, subdivisions, parks/facilities/trails, water districts, and habitat. These are catalog titles, not tested feature schemas or permission to acquire sensitive data. No habitat, parcel, voter or person-level features were collected in this verification.

## Verified item, service and layer

- Catalog item: [Travis County Commissioner Precincts](https://www.arcgis.com/home/item.html?id=a8c819373dcf4535b0a7edf0a09b7f04), ID `a8c819373dcf4535b0a7edf0a09b7f04`.
- Service: `https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/Travis_County_Commissioner_Precincts/FeatureServer`.
- Layer: service path plus `/0`, name `Travis_County_Commissioner_Precincts`.
- The service advertises a different `serviceItemId`, `8fef8a0a70a04b1aa04308e593df6671`. A sharing-item lookup returned an ArcGIS JSON error 400, “Item does not exist or is inaccessible,” inside HTTP 200. Preserve this distinction; the public catalog item and anonymous layer remain usable. Do not retry permanent JSON errors or invent access to the advertised item.
- Service and layer `maxRecordCount=2000`; service capabilities `Query,Extract`; tested query format Esri JSON. `Extract` is advertised capability, not a verified bulk download route. Do not guess a Hub export URL, initiate an export job, or substitute GeoJSON/CSV without separately verifying geometry and scope.
- Layer supports pagination and ordering. Object ID field `OBJECTID`; geometry `esriGeometryPolygon`; `hasZ=false`, `hasM=false`; native SR `wkid=102739`, `latestWkid=2277`. Keep the complete service/layer spatial-reference objects (including tolerances/units), extents, field definitions/aliases/domains/nullability and capabilities, not only the abbreviated IDs here.
- Full metadata has ten fields: `OBJECTID`, `PRECINCT`, `COMMISSIONER`, `PrecinctWebPage`, `CommissionerPicture`, `Sq_Mi`, `DISTRICT`, `NAME`, `Shape__Area`, `Shape__Length`. Acquisition selected only `OBJECTID,PRECINCT,Sq_Mi,Shape__Area,Shape__Length`, excluding official names, pictures and links. This is complete record/geometry coverage of this layer at the checks below, with intentionally partial attribute coverage.
- Public catalog item `modified=1769711456000` and `created=1731536315000` are raw ArcGIS epoch milliseconds. They are item provenance, not feature edit timestamps. The queried metadata did not expose `editingInfo`; layer is versioned. Save retrieval UTC times and HTTP headers. Do not claim a transactionally consistent or historical snapshot.
- The item disclaimer says it is for reference/informational purposes, is not an on-the-ground survey, may not suit legal/engineering/surveying purposes, and offers no accuracy/completeness warranties. Retain the current terms with the metadata.

## Serial request, file and recovery gate

Choose an operator-approved private archive outside the checkout and set environment variable `ARCHIVE` to it. Raw responses, headers (which may contain cookies), logs, scans and checksums stay there. Use a trusted directory without symlink components. Never derive a filename from a server title, URL or Content-Disposition.

In a shell, acquire a single-writer lock for the whole session and enter a fresh run directory:

```sh
: "${ARCHIVE:?Set an approved private archive directory first}"
umask 077
mkdir -p "$ARCHIVE"
mkdir "$ARCHIVE/.tnr-writer-lock" || exit 1
RUN_ID="tnr-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$ARCHIVE/$RUN_ID" || exit 1
cd "$ARCHIVE/$RUN_ID" || exit 1
```

Record the lock owner's PID and run directory privately. Do not remove another owner's lock. On an interrupted session, first establish that its owner/transfer has exited, reacquire the lock, and inspect the existing run rather than starting overlapping writers. Retain any pending cooldown across a restart by reading the latest attempt headers and finish time; if uncertain, stop for operator review. Release only your own empty lock with `rmdir "$ARCHIVE/.tnr-writer-lock"` after all transfers and validations finish. A lock-directory failure means stop, not force.

For each request set `NAME` to a fixed safe label (letters/digits/hyphens only), `URL` to the verified HTTPS endpoint, `ATTEMPT=1`, and `set --` to its query arguments. For example:

```sh
NAME=precinct-count-before
ATTEMPT=1
URL='https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/Travis_County_Commissioner_Precincts/FeatureServer/0/query'
set -- --data-urlencode 'f=json' --data-urlencode 'where=1=1' --data-urlencode 'returnCountOnly=true'
```

Execute this one transfer, with no concurrent requests, background transfers, automatic redirects or curl built-in retry loop. Keep `--disable` as curl's first argument to suppress default curlrc options that could silently add requests, cookies or authentication:

```sh
test ! -e "$NAME.body" || exit 1
date -u +%Y-%m-%dT%H:%M:%SZ > "$NAME-a$ATTEMPT.started"
curl --disable --silent --show-error --proto '=https' \
  --connect-timeout 15 --max-time 45 --max-filesize 5000000 \
  --user-agent 'atxdata-public-access-check/0.1' \
  --dump-header "$NAME-a$ATTEMPT.headers" \
  --output "$NAME-a$ATTEMPT.part" \
  --write-out '%{http_code}\t%{url_effective}\n' \
  --get "$URL" "$@" > "$NAME-a$ATTEMPT.response"
CURL_EXIT=$?
date -u +%Y-%m-%dT%H:%M:%SZ > "$NAME-a$ATTEMPT.finished"
printf '%s\n' "$CURL_EXIT" > "$NAME-a$ATTEMPT.exit"
```

Before any next attempt/request, inspect the saved headers and status, including on HTTP 200:

- Wait at least two seconds after full transfer completion. Published source quotas override this default; inspect current terms and any service-specific notices before collection. No numeric request quota or rate-limit/cooldown header was observed in the verification responses; this is not proof of unlimited access.
- Honor the longest server cooldown, without capping it: `Retry-After` seconds or HTTP date (relative to server `Date` when present); exhausted `RateLimit-Remaining: 0` plus `RateLimit-Reset` seconds; `X-RateLimit-Remaining: 0` plus epoch `X-RateLimit-Reset`; structured `RateLimit` policies with `r=0;t=SECONDS`. If a quota/header cannot be interpreted or a reset is missing, stop for manual interpretation. Record the resulting next-allowed UTC time privately, even when stopping. Do not make the next request early just because a successful body has arrived.
- Retry only transient HTTP 408/409/425/429/5xx or transient connection/timeout failures, at most two retries (three attempts total). Delay is the longest of the two-second gap, server cooldown, and exponential backoff `2^(ATTEMPT-1)` seconds plus uniformly sampled 0–1 second jitter. Increment `ATTEMPT`, preserve each failure's files, and repeat the whole transfer. Permanent HTTP/ArcGIS JSON errors, redirects, size-limit failures, schema failures and challenges stop immediately. Review a redirect's destination/authority separately and apply the same gate before following it. Never bypass a challenge or weaken the byte ceiling automatically.
- Require curl exit 0, HTTP 200, parseable expected JSON and no top-level `error`. A JSON error inside 200 is failure. Verify expected schema/counts before accepting data. Do not promote error HTML or truncated content.

After checking a successful JSON response, promote on the same filesystem, using this validation and checksum example:

```sh
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d,dict) and "error" not in d' "$NAME-a$ATTEMPT.part" && \
  mv "$NAME-a$ATTEMPT.part" "$NAME.body" && \
  shasum -a 256 "$NAME.body" >> checksums.sha256
```

Keep the response's effective URL/query, timestamps, exit/status, byte count, hash and header filename as provenance. Promotion means complete transport and valid JSON, not acceptance of the entire layer: completeness validation below is a separate gate. A failed verification never marks a run complete. On restart, `shasum -a 256 -c checksums.sha256` verifies completed bodies offline; retain them without refetching. If a body is missing/corrupt, quarantine it, remove only its stale checksum entry after recording the failure, and repeat only that request under the same gate. Unpromoted attempt `.part` files are not checkpoints; retain or remove them after recording the failed attempt and restart that transfer from byte zero. Do not use byte-range continuation for mutable JSON. A deliberate 100-byte ceiling produced curl exit 63 with no promoted file; a subsequent full transfer reproduced the original first-page SHA-256. Offline checksum rerun succeeded without more source requests.

## Bounded acquisition and completeness

Apply the gate separately to every request below. Save all original bodies, not only projected features. Use the verified service/layer URLs above. Fetch item, service and layer metadata with `f=pjson` (or `f=json`) before records. Stop if this layer's current identity, schema, permissions or capabilities differ; do not silently apply this recipe to another layer.

1. `precinct-count-before`: layer `/query`, `f=json`, `where=1=1`, `returnCountOnly=true`. Require an integer count between 1 and 10 before requesting IDs or features; otherwise stop and obtain a new bounded scope.
2. `precinct-ids-before`: same route, `f=json`, `where=1=1`, `returnIdsOnly=true`, `returnGeometry=false`. Require a numeric unique ID array, no transfer-limit flag, count equal to the count query, and count between 1 and 10. A larger result exceeds this acquisition budget; stop or obtain a separately authorized, explicitly partial subset. Do not start an all-layer backfill.
3. `precinct-page-0` and `precinct-page-2`: two separate queries, each with:

   ```sh
   set -- --data-urlencode 'f=json' --data-urlencode 'where=1=1' \
     --data-urlencode 'outFields=OBJECTID,PRECINCT,Sq_Mi,Shape__Area,Shape__Length' \
     --data-urlencode 'returnGeometry=true' --data-urlencode 'orderByFields=OBJECTID ASC' \
     --data-urlencode 'resultRecordCount=2' --data-urlencode 'resultOffset=0'
   ```

   Change only `resultOffset=0` to `resultOffset=2` for the second page. Do not set `outSR`, quantization or geometry simplification. At verification the count was four; if it changes, stop and re-plan a bounded set of pages (at most five of two, each below `maxRecordCount`). The tested first page had `exceededTransferLimit=true`; that means continue, not success. The second page omitted that flag and ended the enumeration. Never assume that a missing flag alone establishes completeness.
4. `precinct-count-after` and `precinct-ids-after`: repeat the first two queries after all pages, with new evidence labels. Require unchanged counts and identical ID sets, no truncation, every expected ID exactly once in the merged features, matching schema and native SR on every page. An empty/short page, duplicate or missing ID, unexpected transfer flag or changed ID set fails acceptance. Preserve failures; do not keep paginating blindly. For a future service lacking pagination/ordering, a separately bounded ID-batch workflow may be needed; it was not exercised here.
5. Validate polygon rings are nonempty, closed, have at least four vertices, finite numeric coordinates, and lie within the metadata extent (allow a small numeric rounding tolerance). Preserve original rings and SR; do not reinterpret state-plane coordinates as longitude/latitude. This is structural validation, not a topology/accuracy audit.

Run this offline count/ID/schema/SR check in the private run directory after saving the named bodies:

```sh
python3 - <<'PY' || exit 1
import json
import math

def load(name):
    with open(name + '.body') as f:
        value = json.load(f)
    assert isinstance(value, dict) and 'error' not in value
    return value

before, after = load('precinct-count-before'), load('precinct-count-after')
a, b = load('precinct-ids-before'), load('precinct-ids-after')
pages = [load('precinct-page-0'), load('precinct-page-2')]
layer = load('precinct-layer')
extent = layer['extent']
assert layer['objectIdField'] == 'OBJECTID' and layer['maxRecordCount'] >= 2
assert len(layer['fields']) == 10 and not layer['hasZ'] and not layer['hasM']
assert before == after == {'count': 4}
assert a['objectIdFieldName'] == b['objectIdFieldName'] == 'OBJECTID'
expected = set(a['objectIds'])
assert len(a['objectIds']) == len(b['objectIds']) == len(expected) == 4
assert expected == set(b['objectIds'])
assert not a.get('exceededTransferLimit', False) and not b.get('exceededTransferLimit', False)
features = [r for p in pages for r in p['features']]
actual = [r['attributes']['OBJECTID'] for r in features]
assert len(actual) == len(set(actual)) == 4 and set(actual) == expected
assert pages[0]['exceededTransferLimit'] is True
assert not pages[-1].get('exceededTransferLimit', False)
selected = {'OBJECTID', 'PRECINCT', 'Sq_Mi', 'Shape__Area', 'Shape__Length'}
metadata_fields = {f['name']: f for f in layer['fields']}
assert set(layer['extent']['spatialReference'].items()) >= {('wkid', 102739), ('latestWkid', 2277)}
for p in pages:
    assert len(p['features']) == 2
    assert p['geometryType'] == 'esriGeometryPolygon'
    assert p['spatialReference'] == {'wkid': 102739, 'latestWkid': 2277}
    assert {f['name'] for f in p['fields']} == selected
    assert p['fields'] == pages[0]['fields']
    for field in p['fields']:
        assert all(field[key] == metadata_fields[field['name']][key] for key in ('type', 'alias'))
    for r in p['features']:
        assert set(r['attributes']) == selected and r['geometry']['rings']
        for ring in r['geometry']['rings']:
            assert len(ring) >= 4 and ring[0] == ring[-1]
            for x, y in ring:
                assert isinstance(x, (int, float)) and isinstance(y, (int, float))
                assert math.isfinite(x) and math.isfinite(y)
                assert extent['xmin'] - .01 <= x <= extent['xmax'] + .01
                assert extent['ymin'] - .01 <= y <= extent['ymax'] + .01
print('Verified four unique records across two pages; count/IDs/schema/SR agree.')
PY
shasum -a 256 -c checksums.sha256
```

## Actual verification and limits

Anonymous live acquisition obtained four polygons, IDs `5,6,7,8`, across two ordered pages of two. Before/after count queries both returned four; before/after object-ID sets and merged feature IDs agreed without duplicates. All 15,056 coordinate pairs were finite, rings closed and coordinates within the layer extent; full ten-field metadata and native SR/tolerances were retained privately. Selected attributes intentionally exclude name/picture fields. Page bytes and SHA-256:

| Response | Bytes | SHA-256 |
| --- | ---: | --- |
| Offset 0 | 277433 | `4d151fb29b4891d07feb284c152dafbb13ad382cc99a443ac7348c430d037897` |
| Offset 2 | 323135 | `a2e9e6186f4746301276e06ad76bd5c63dfc2c05aed68bf6de880869fb0910f9` |

These checks establish bounded record and geometry completeness for this one live layer observation, not all attributes, historical coverage, catalog-wide extraction, consistent geometry across concurrent edits, or a durable offsite archive. Stable counts/IDs cannot detect every in-place edit; no transactional snapshot was available in this workflow. No bulk export, ID-batch fallback, automated update tracking, HTTP transient-retry branch or actual server-issued cooldown was live-tested. Manual gates are operator responsibilities, not tested client guarantees.

This deliverable changes documentation only. TDD/CRAP/coverage, dryer structural duplication at 0.8, mutation testing, typecheck and SQLite integrity/client recovery gates are not applicable; no production code/client was added or changed. Live content/pagination checks, local checksum rerun, capped-failure/full-transfer recovery, command validation and publication scans are the applicable evidence. Independent review remains a separate operator-owned gate.

## Current source-wide collector

The current [program README](../../../programs/arcgis-consume/README.md) documents selectable advertised items/services/layers/ranges, resumable catalog discovery and configurable finite acquisition bounds. Independent timing/guard recheck and chief integration passed88tests/typecheck plus the two unchanged operator-policy failures; rules.ts is unchanged. Gate rollback is checked against independent timing evidence. Older ledgers missing those facts require explicit review, not automatic migration. Actual original4/308bytes reconstructed NEW compatible ledgers, not recovered historical collector state. These local checks add no fresh public search/acquisition or historical-coverage proof.

## Historical bounded collector implementation (2026-11-06)

The manual recipe above remains a retained observation, not the new runtime. [arcgis-consume](../../../programs/arcgis-consume/README.md) now implements the named TNR feature-query strategy and the separate Voter Maps published-file strategy through one Bun/TypeScript adapter, using existing collector HTTP/streaming/archive helpers and SQLite provenance. `rules`, `discover`, `collect`, `sync`, `status` and zero-HTTP `verify` commands, bounds, reviewed terms hashes and recovery rules are documented there. Runtime state/originals remain outside source.

Live named-layer collection reacquired four polygons (IDs 5,6,7,8), preserving five selected attributes and the complete native state-plane metadata; the two original page hashes matched this retained recipe. Before/after counts and IDs reconciled. Offline verification and duplicate collection sent zero HTTP. This does not establish historical, transactional, topology or all-attribute completeness.

Do not count TNR catalog search as revalidated by the new wrapper: prior site-data discovery intermittently raised a native Bun stream TypeError, its failed run is retained, and the declared sample request budget was exhausted before search. One later capped diagnostic acquired original site-data, whose current group predicate was validated offline; that is not a completed catalog search. The narrow reader-ownership fix was tested with retained-byte localhost subprocess replays and zero-HTTP verification, not new public requests. Unattended readiness and fresh independent recheck remain outstanding. See the program README for public evidence hashes, quality scope and limitations.
