# Voter Registration Maps: one bounded geographic publication

Verified 2026-11-04. This is a manually gated access skill, not an unattended client, voter-roll collector or historical archive. Requires curl, Python 3, SHA-256 (`shasum -a 256` on macOS), and `pyshp==2.3.1` in an operator-approved private virtual environment. No account, token, Bun or SQLite is required. Invoke that environment's Python as `python3` below. Original bytes, headers, signed redirect URLs, editor metadata and logs stay outside the checkout.

## Authority, discovery and budget

Start at the [Voter Registration Maps hub](https://voter-registration-maps-traviscountytx.hub.arcgis.com/), which identifies the Voter Registration Division of the Travis County Tax Office. Unlike TNR, this hub uses site item `7900dcb8fa674dcf93bcbbd49c29e0db`, organization `HGcSYZ5bvjRswoCb`, and one catalog group, `16f087181c9b4ccb9e42ad3fb7c78c3e`.

Use the serial transfer gate below for every discovery request. ArcGIS sharing base is `https://www.arcgis.com/sharing/rest`:

1. Fetch `/content/items/7900dcb8fa674dcf93bcbbd49c29e0db?f=json` and `/content/items/7900dcb8fa674dcf93bcbbd49c29e0db/data?f=json`. Confirm current `catalogV2.scopes.item.filters` and legacy `catalog.groups` agree with the intended scope; do not assume TNR groups apply.
2. Fetch `/search` with `f=json`, `q=group:16f087181c9b4ccb9e42ad3fb7c78c3e`, `num=100`, `start=1`, `sortField=title`, `sortOrder=asc`. Preserve original result IDs/types/URLs/dates. Verification returned 16 distinct item IDs, `total=16`, `nextStart=-1`, including maps/pages/services, not 16 electoral layers. If another page appears, stop for a new discovery budget; do not silently expand scope.
3. The catalog's GIS Maps and Downloads page is item `01d0de7cfee64dca91126735e27cd5e5`. Its `/data?f=json` explicitly links the Election Precincts Shapefile item below, election-precinct PDFs, and other district PDFs. Catalog web map `ad1c6216c2844f7e9175887d34cb75b4` has a `/data?f=json` configuration exposing election-precinct service URLs. These are metadata observations, not acquisitions of every linked resource.
4. Fetch `/content/items/bc55843a0d9a4044a9ba46952007c6fc?f=json` as `bulk-item.body`. Require `type=Shapefile`, public access, expected title/name and size at most 1000000 bytes before downloading. At verification it was 656459 bytes. Inspect description/license for current terms and restrictions. No numeric request quota was found in the inspected metadata; no rate-limit/cooldown header was observed. Neither implies unlimited access.

Budget: one catalog page, the named metadata/configuration requests, and one published ZIP containing one geographic layer; at most 25 HTTP attempts total including redirect and recovery checks. Do not query address points, property-owner features, surveys/forms or individual voter records. The catalog includes such adjacent subjects; geographic discovery is not permission to collect them. Never use the service's advertised editing capabilities.

## Geographic identity and publication provenance

- Published bulk item: [Election Precincts](https://www.arcgis.com/home/item.html?id=bc55843a0d9a4044a9ba46952007c6fc), filename `Election_Precincts.zip`. Download entry: `https://www.arcgis.com/sharing/rest/content/items/bc55843a0d9a4044a9ba46952007c6fc/data`.
- Item `created=1771450696000`, `modified=1771450717000` (ArcGIS epoch milliseconds); file HTTP `Last-Modified: Wed, 18 Feb 2026 21:38:34 GMT`. Item description says precincts were approved on 12/4/2025 and affected by Congressional Redistricting PLAN C2333, 89th Legislature, 2nd Called Session, 2025. These are distinct publication/approval assertions, not collection times or an election-validity determination.
- The ZIP contains exactly `Election_Precincts` with extensions `.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`, `.shp.xml`. Retain all six without rewriting. The original PRJ is NAD 1983 StatePlane Texas Central FIPS 4203 Feet, Lambert Conformal Conic, US survey feet (`0.3048006096012192` meters per unit); not longitude/latitude.
- DBF fields: `Precinct,VoterCount,Congressio,Senate,Legislativ,Commission,JPConstabl,StateBoard,Creator,Created,LastEditor,LastEdited`. `Precinct` is the verified unique identity in this publication. DBF's ten-character names truncate longer district names; retain exact schema and source metadata, not guessed renamings. `VoterCount` is a precinct aggregate, not individual voters. Creator/editor fields identify publishers; keep raw records private, not in source examples. All observed DBF Created/LastEdited dates were 2025-12-18. XML metadata includes stale dates and required-field placeholders; do not promote those to authoritative currency/history.
- The web map points to `https://taxmaps.traviscountytx.gov/arcgis/rest/services/Precincts/FeatureServer/0`, layer `DBO.Precincts`, catalog item `28b01d2a79e44ce49d865e03dfa26239`. Service/layer advertise a different `serviceItemId`, `b42135ca1f5b4a11897d57e0c2a37eba`; no lookup of that item was tested. Preserve both identities.
- Anonymous service and layer metadata were read with `f=json`: polygon geometry, `hasZ=false`, `hasM=false`, native `wkid=102739`, `latestWkid=2277`, full SR/tolerances/units/extent, 11 field definitions, `maxRecordCount=2000`, pagination/order supported. Live service fields differ from the ZIP: an OBJECTID and full-length district names replace publisher/date attributes. Save both schemas; do not equate DBF row numbers to service OBJECTIDs.
- A read-only live `/0/query` with `f=json`, `where=1=1`, `returnCountOnly=true` returned 308, matching the ZIP's 308 records. This corroborates counts only: no live service features or object-ID set were fetched, so service-to-ZIP ID/geometry/version equality is unproved. No bulk export job was initiated; this is an already-published ZIP.

## Serial transfer, cooldown and recovery gate

Set `ARCHIVE` to an approved absolute private archive path outside the checkout (trusted directory, no symlink components). Relative paths are rejected before any directory or lock is created, so changing into the run directory cannot change the lock path's meaning. Use a private shell/umask and one session-wide writer lock:

```sh
: "${ARCHIVE:?Set an approved private archive first}"
case "$ARCHIVE" in /*) ;; *) exit 1;; esac
umask 077
mkdir -p "$ARCHIVE"
mkdir "$ARCHIVE/.voter-maps-writer-lock" || exit 1
RUN_ID="voter-maps-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$ARCHIVE/$RUN_ID" || exit 1
cd "$ARCHIVE/$RUN_ID" || exit 1
```

Privately record the lock owner's PID and run path. A failed lock is a stop, not an invitation to force removal. After interruption, establish that the previous owner and curl have exited; inspect its files and pending cooldown before reacquiring. Do not remove another owner's lock. Release your own empty lock with `rmdir "$ARCHIVE/.voter-maps-writer-lock"` only after transfers/validation finish.

For each request, assign fixed `NAME` (lowercase letters/digits/hyphens), `ATTEMPT=1`, verified HTTPS `URL`, and explicit query arguments via `set --`. For example, the bulk metadata request:

```sh
NAME=bulk-item
ATTEMPT=1
URL='https://www.arcgis.com/sharing/rest/content/items/bc55843a0d9a4044a9ba46952007c6fc'
set -- --data-urlencode 'f=json'
```

Before executing the following single transfer, apply all pacing/cooldown rules below from the preceding completed transfer. Do not run concurrent/background requests, automatic redirects or built-in curl retries. `--disable` MUST be curl's first option; a curlrc must not inject authentication, redirects or extra requests.

```sh
case "$NAME" in ''|*[!a-z0-9-]*) exit 1;; esac
case "$ATTEMPT" in 1|2|3) ;; *) exit 1;; esac
for F in "$NAME.body" "$NAME-a$ATTEMPT.part" "$NAME-a$ATTEMPT.headers" \
  "$NAME-a$ATTEMPT.started" "$NAME-a$ATTEMPT.finished" \
  "$NAME-a$ATTEMPT.response" "$NAME-a$ATTEMPT.exit"; do
  test ! -e "$F" || exit 1
done
date -u +%Y-%m-%dT%H:%M:%SZ > "$NAME-a$ATTEMPT.started"
curl --disable --silent --show-error --proto '=https' \
  --connect-timeout 15 --max-time 45 --max-filesize 5000000 \
  --user-agent 'atxdata-public-access-check/0.1' \
  --dump-header "$NAME-a$ATTEMPT.headers" --output "$NAME-a$ATTEMPT.part" \
  --write-out '%{http_code}\t%{url_effective}\n' \
  --get "$URL" "$@" > "$NAME-a$ATTEMPT.response"
CURL_EXIT=$?
date -u +%Y-%m-%dT%H:%M:%SZ > "$NAME-a$ATTEMPT.finished"
printf '%s\n' "$CURL_EXIT" > "$NAME-a$ATTEMPT.exit"
```

Mandatory manual gates (curl alone does not implement them):

- Wait at least two seconds after each full transfer completes. Obey any stricter published quota. Inspect headers even on HTTP 200; honor the longest `Retry-After` (seconds or HTTP date, using server Date for skew), exhausted `RateLimit-Remaining: 0` with relative reset, exhausted `X-RateLimit-Remaining: 0` with epoch reset, and structured `RateLimit` policies `r=0;t=SECONDS`. Never cap server delays. Uninterpretable headers or missing resets require stopping for manual interpretation. Record the next-allowed UTC time privately, including across restart.
- At most three attempts per request, within the total budget. Retry only transient HTTP 408/409/425/429/5xx or transient transport/timeouts, with delay equal to the longest of server delay, two seconds, and `2^(ATTEMPT-1)` seconds plus uniform 0–1 second jitter. Increment ATTEMPT and retain each failed attempt. Permanent errors (including ArcGIS JSON error inside HTTP 200), challenges, size/schema failures or exhausted retries stop. A size failure must not be mistaken for a transient network failure from its exit code alone.
- For expected JSON require curl exit 0, HTTP 200, parseable dictionary without top-level `error`, then inspect the request-specific schema before promotion. For example, after checking bulk-item identity/access/type/size: `python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d,dict) and "error" not in d' "$NAME-a$ATTEMPT.part" && mv "$NAME-a$ATTEMPT.part" "$NAME.body" && shasum -a 256 "$NAME.body" >> checksums.sha256`. Save effective URL, timestamps, status/exit, bytes and hashes. JSON validity is not geographic completeness.
- The bulk `/data` entry returned HTTP 302 to an HTTPS `www.arcgis.com/itemdata/` URL ending `/Election_Precincts.zip`, with expiring signed query parameters. Do not promote the redirect body or publish/reuse that URL as a permanent source. Inspect Location privately, verify the exact scheme/host/path before following, honor the same cooldown gate, assign a fresh fixed NAME and `set --` (no `f=json`), then transfer that URL explicitly. Stop if the destination/filename/authority changes. On expiration obtain a new redirect from the stable entry, not a guessed URL; do not bypass a challenge.
- For the ZIP require curl exit 0, HTTP 200, expected ZIP content type/signature, metadata size match and validation below BEFORE atomic same-filesystem `mv` to `election-precincts.body`. Re-fetch bulk item metadata as `bulk-item-after.body` under the same gate and require unchanged ID/created/modified/size. A failed validation leaves the run incomplete.
- On restart verify `shasum -a 256 -c checksums.sha256` offline and reuse accepted files without HTTP. Missing/corrupt files require quarantine, recording the failure and removal of only the stale checksum entry; repeat only that transfer. Never treat `.part` as complete or append mutable JSON/ZIP using byte-range resume. A new remote version gets a fresh run, not overwriting evidence. Counts/metadata stability do not provide transactional snapshot isolation.

## Offline ZIP verification

Set `ZIP_BODY` to the downloaded ZIP attempt `.part` path (or accepted body for an offline rerun), and run in the private directory holding `bulk-item.body` and `bulk-item-after.body`. This check pins the verified publication; changed hashes/schema/counts stop for a new bounded review, not automatic acceptance. No extraction to server-controlled paths is needed.

```sh
export ZIP_BODY
python3 - <<'PY' || exit 1
import hashlib, io, json, math, os, struct, zipfile
import shapefile
before = json.load(open('bulk-item.body'))
after = json.load(open('bulk-item-after.body'))
assert before['id'] == after['id'] == 'bc55843a0d9a4044a9ba46952007c6fc'
assert before['type'] == after['type'] == 'Shapefile'
assert before['access'] == after['access'] == 'public'
assert all(before[k] == after[k] for k in ('created','modified','size'))
b = open(os.environ['ZIP_BODY'], 'rb').read()
assert b.startswith(b'PK\x03\x04') and len(b) == before['size'] == 656459
assert hashlib.sha256(b).hexdigest() == '108837b38a9f913740577b5ab0784c40022df20ea0e00930b56ba0b9bb145c41'
base = 'Election_Precincts'
with zipfile.ZipFile(io.BytesIO(b)) as z:
    assert len(z.infolist()) == 6
    assert set(z.namelist()) == {base+e for e in ('.cpg','.dbf','.prj','.shp','.shp.xml','.shx')}
    assert sum(i.file_size for i in z.infolist()) < 2000000
    assert all(not i.flag_bits & 1 for i in z.infolist()) and z.testzip() is None
    shp, shx, dbf = [z.read(base+e) for e in ('.shp','.shx','.dbf')]
    prj = z.read(base+'.prj').decode()
    assert 'NAD_1983_StatePlane_Texas_Central_FIPS_4203_Feet' in prj
    assert 'UNIT["Foot_US",0.3048006096012192]' in prj
    assert all(struct.unpack('>i', v[24:28])[0]*2 == len(v) for v in (shp,shx))
    assert (len(shx)-100)//8 == struct.unpack('<I', dbf[4:8])[0] == 308
    r = shapefile.Reader(shp=io.BytesIO(shp), shx=io.BytesIO(shx), dbf=io.BytesIO(dbf), encoding=z.read(base+'.cpg').decode())
    assert r.shapeType == 5
    assert [f[0] for f in r.fields[1:]] == ['Precinct','VoterCount','Congressio','Senate','Legislativ','Commission','JPConstabl','StateBoard','Creator','Created','LastEditor','LastEdited']
    rows, shapes = r.records(), r.shapes()
    ids = [rec['Precinct'] for rec in rows]
    assert len(rows) == len(shapes) == len(set(ids)) == 308 and all(ids)
    vertices = rings = 0
    for s in shapes:
        assert s.shapeType == 5 and s.parts and s.parts[0] == 0
        bounds = list(s.parts) + [len(s.points)]
        for start, end in zip(bounds, bounds[1:]):
            ring = s.points[start:end]
            assert len(ring) >= 4 and ring[0] == ring[-1]
            rings += 1
            for x, y in ring:
                assert math.isfinite(x) and math.isfinite(y)
                assert r.bbox[0] <= x <= r.bbox[2] and r.bbox[1] <= y <= r.bbox[3]
                vertices += 1
    print('Verified:',len(rows),'records;',len(set(ids)),'unique precincts;',rings,'rings;',vertices,'vertices')
PY
```

After successful validation, promote only the accepted attempt with `mv` to the unused `election-precincts.body` filename and append its SHA-256 to `checksums.sha256`; do not overwrite an existing accepted body. Keep full metadata, original ZIP, headers and retrieval UTC times. Preserve the PRJ verbatim. Structural validation is not a topology, legal-boundary or surveying audit.

## Actual verification and limits

The 656459-byte published ZIP had SHA-256 `108837b38a9f913740577b5ab0784c40022df20ea0e00930b56ba0b9bb145c41`. SHP/SHX/DBF counts reconciled at 308; all 308 Precinct identities were nonempty/unique; 308 polygon rings and 65699 finite coordinate pairs passed closure/bounding checks. Before/after bulk item metadata was identical. Full-file completeness for this publication needs no REST feature pagination: no pagination of live features was exercised. Matching live count alone does not prove equal content. This is one small geographic layer, not all maps/services, current election results, individual voter records or historical snapshots.

A deliberate 100-byte ceiling on the ZIP transfer failed with curl exit 56, stderr `Maximum file size exceeded`, and no promoted body. Repeating the full transfer matched the original hash. A separate offline checksum rerun verified all 13 accepted primary evidence bodies without more source requests. The exact documented curl block and offline validator were also replayed against the ZIP, validating before promotion and reproducing the same hash; the validator rejected a truncated copy. Existing-body and overlap-lock guards stopped without a transfer. Actual server-issued cooldowns and transient HTTP retry branches were not encountered/tested. Manual lock/pacing/cooldown/retry/version decisions remain operator duties, not automated client guarantees.

Documentation-only deliverable: TDD/coverage/CRAP below 10, dryer code similarity at 0.8, mutator, TypeScript typecheck and SQLite/client-state integrity gates are not applicable; no production client code changed. Executable documentation, real ZIP/geometry/schema/identity validation, failure/full-transfer recovery, local checksum reruns and publication scans are the applicable checks. Independent review is chief-owned and remains a separate gate.

## Bounded collector implementation (2026-11-06)

The retained manual recipe above is separate from [arcgis-consume](../../../programs/arcgis-consume/README.md), a new headless Bun/TypeScript library/CLI using one reusable ArcGIS adapter for this publication and TNR. `rules`, bounded `discover`, `collect`/`sync`, SQLite `status`, and zero-HTTP `verify` commands are documented in its README. Source state, raw files, HTTP headers, publisher attributes and signed redirects remain private outside source.

Live publication collection retained the 656459-byte original ZIP with SHA-256 `108837b38a9f913740577b5ab0784c40022df20ea0e00930b56ba0b9bb145c41`; six exact components, CRCs, native PRJ, SHP/SHX/DBF counts and 308 unique geographic identities reconciled. Geometry checks covered 308 rings and 65699 vertices. Published item before/after metadata was stable. New-wrapper discovery obtained one current 16-item catalog page using the Voter hub's actual `group:[...]` predicate and matching legacy group, rather than TNR's `group:{any:[...]}` expression. Adjacent address-point/form items were metadata only, not acquired records.

The permanent item-data entry is the source identity; signed redirect destinations are temporary private transport material. Current counts are observations, not hardcoded future record expectations. Matching a live-service count does not prove ZIP/service identity, geometry or version equality, and the wrapper makes no such claim. Current-code offline verification of retained original bytes and duplicate collection issue zero HTTP; they are not new live acquisition. Quality tests, bounded mutation scope and the locally replayed TNR reader-ownership fix are detailed in the program README; fresh independent recheck remains chief-owned and outstanding.
