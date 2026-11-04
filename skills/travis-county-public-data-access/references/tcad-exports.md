# TCAD bounded public exports

Intent: LLM-authored, supervised anonymous acquisition of a TCAD certified appraisal archive with a bounded valuation-row check, plus the earlier small ancillary CSV and published bulk layout. TCAD is a separate appraisal district, not the county Tax Office. This is not an unattended collector or complete historical archive. No program or SQLite service is added. Raw rows, property/account keys, situs addresses, headers/cookies and validation logs belong only in a private operator-approved archive outside source.

## Discovery and version identity

Start at https://traviscad.org/publicinformation and inspect https://traviscad.org/robots.txt before any further request. On 2026-11-04 robots advertised `Crawl-delay: 10`. Use at least ten seconds after each complete transfer; honor longer published/server instructions. The page linked the following paths relative to `https://traviscad.org/wp-content/`:

| Publication | Path | HEAD Content-Length; acquisition |
| --- | --- | --- |
| Export Layouts | `largefiles/Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip` | 248399; full ZIP acquired |
| 2026 Certified Appraisal Export (July) | `largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip` | 557228168; complete archive acquired under explicit expanded authorization |
| 2026 Certified Special Export (JSON) (July) | `largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip` | 3554021795; HEAD only |
| 2026 Supplemental Appraisal Roll Export | `largefiles/travis_SUPP%20335_2026_WEBSITE%20EXPORT_Renamed.zip` | 511099040; HEAD only |
| 2026 Supplemental Special Export (JSON) | `largefiles/2026%20Special%20export%20Supp%203%2010062026.zip` | 3565655178; HEAD only |
| Waterfront Effective Front Foot 2026 | `uploads/waterfront_effective_front_foot_report_2026.csv` | 287774; complete small report acquired |

The page also linked `uploads/ag_activities_2026.csv`, `uploads/land_comments_2026.csv` and certified totals PDFs for 2022–2026. Those bodies were not acquired. Recheck links/sizes, never silently download the large rolls. The small-file procedure below remains limited to one data file <=12 MiB and one layout ZIP <=1 MiB. Only the separately authorized certified procedure permits ONE archive GET <=640 MiB compressed; no supplemental roll or JSON download is authorized. HEAD size is advisory; enforce a body ceiling too.

Keep page label, exact source filename/URL, retrieval UTC date, HTTP Date/Last-Modified, byte length and SHA-256 together. Filename dates and HTTP dates are not proof of certification. In particular, the roll filename says `SUPP 335`, while the special JSON filename says `Supp 3`; do not normalize them into the same version. Certified filename identity is `Supp 0` / `07182026`. The layout ZIP identifies `Legacy8.0.33` and `06182026`; its response Last-Modified was 2026-07-08, which is a different kind of date.

The acquired seven-page PDF, `Legacy8.0.33-AppraisalExportLayout.pdf`, describes fixed-width Property `APPRAISAL_INFO.TXT` (short name `PROP.TXT`). It names distinguishing fields `prop_id`, `prop_val_yr`, `owner_id`, `sup_num`, and explains `sup_num=0` as certified and other values as supplemental. It allows repeated property IDs for multiple owners. Preserve all keys as strings, including numeric-looking IDs; verify any later roll's actual fields/version before joining. The ZIP also contains an XLSX; its sheet schema was not independently interpreted. The retained PDF's 493 contiguous fixed-width fields were compared with the first 25 real `PROP.TXT` rows in the certified archive, not every roll row. This is NOT a layout for the waterfront CSV.

## Supervised safe transfer

Prerequisites: dedicated Bash session, curl, Python 3 standard library, Poppler `pdftotext`. The operator supplies an existing empty canonical absolute directory via exported `ARCHIVE`, owned by the current user with mode 0700, outside any checkout. No literal external path is prescribed. Use a separate dated directory per snapshot; never replace a previous snapshot. Only one TCAD acquisition may run across ALL directories/shells: the local lock below protects this directory, not the source globally.

Load these helpers in the dedicated shell. Errors terminate that shell. Do not continue after a failed block. The owner token must be retained privately for recovery, never adopted from someone else's lock.

```sh
set -eu
umask 077
set -C
tcad_guard() {
  python3 - "${1:-active}" <<'PY'
import os, pathlib, sys
raw = os.environ.get('ARCHIVE', '')
assert raw and pathlib.Path(raw).is_absolute(), 'absolute ARCHIVE required'
p = pathlib.Path(raw).resolve(strict=True)
assert str(p) == raw and p.is_dir()
assert p.stat().st_uid == os.getuid() and not p.stat().st_mode & 0o077
assert not any((q / '.git').exists() for q in (p, *p.parents)), 'no checkout output'
if sys.argv[1] == 'setup':
    assert not list(p.iterdir()), 'require empty snapshot'
else:
    assert pathlib.Path.cwd().resolve() == p, 'wrong cwd'
    lock = p / '.lock'
    assert lock.is_dir() and not lock.is_symlink()
    owner = lock / 'owner'
    assert owner.is_file() and not owner.is_symlink()
    token = os.environ.get('TCAD_LOCK_ID', '')
    assert token and owner.read_text().strip() == token, 'not this shell lock'
PY
}
```

Initialize once, not on rerun:

```sh
tcad_guard setup
cd -- "$ARCHIVE"
mkdir .lock
TCAD_LOCK_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
export TCAD_LOCK_ID
printf '%s\n' "$TCAD_LOCK_ID" > .lock/owner
tcad_guard
```

Every request, including HEAD, discovery and retries, is a manual gate:

- One in-flight full-body transfer; wait >=10 seconds after completion. No parallelism, automatic redirects, range requests, credentials or cookie reuse. `curl --disable` must be first to suppress curlrc behavior.
- Privately inspect status, MIME, links/body and ALL headers before the next request, including after HTTP 200. Honor `Retry-After` seconds or HTTP date relative to server Date (otherwise current UTC); exhausted `RateLimit-Remaining`/`RateLimit-Reset` seconds, legacy `X-RateLimit-*` epoch reset and structured `RateLimit` policies (`r=0;t=...`). Wait the longest instruction or pacing. If ambiguous, stop; never cap server delays. Persist a private not-before UTC time if handing off.
- No automatic retries. At most three supervised retries, only for 408/409/425/429/5xx or transient connection/body failures. Before retry n (1–3), wait max(server instruction, 10 seconds, `0.5 * 2**(n-1) + U(0,0.25)` seconds). Permanent status, redirects, login/challenge or exhausted budget: stop and report actual failure.
- Fresh fixed filenames only. No server-derived paths. Never promote a failed/size-limited partial. Curl full-body timeout is bounded. An advertised size over the ceiling is a reason NOT to start its GET.

For robots, page discovery and HEAD use this same command shape, fixed fresh local names and a 2 MiB ceiling. Use `--head` for file-size inspection, never a bulk body. Review robots before proceeding. Do not follow redirects automatically. Require HTTP 200 and expected content; a challenge wrapper is not acquisition.

After discovery and current HEAD checks, run the following block TWICE, separately with header/cooldown review between runs. First select the CSV settings, then the layout settings:

```sh
name=waterfront.csv
url=https://traviscad.org/wp-content/uploads/waterfront_effective_front_foot_report_2026.csv
cap=12582912
# For the second transfer instead select:
# name=layouts.zip
# url=https://traviscad.org/wp-content/largefiles/Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip
# cap=1048576
```

```sh
tcad_guard
# Any checkpoint, including a dangling symlink, means offline recovery only.
if test -e VALIDATED.sha256 || test -L VALIDATED.sha256; then exit 1; fi
case "$name:$cap" in waterfront.csv:12582912|layouts.zip:1048576) ;; *) exit 1;; esac
case "$name:$url" in
  waterfront.csv:https://traviscad.org/wp-content/uploads/waterfront_effective_front_foot_report_2026.csv) ;;
  layouts.zip:https://traviscad.org/wp-content/largefiles/Website_Legacy8.0.33-AppraisalExportLayout_06182026.zip) ;;
  *) exit 1;;
esac
for file in "$name" "$name.part" "$name.headers"; do
  if test -e "$file" || test -L "$file"; then exit 1; fi
done
sleep 10
curl --disable --silent --show-error --fail --connect-timeout 15 --max-time 90 \
  --max-filesize "$cap" --dump-header "$name.headers" --output "$name.part" "$url"
```

## Validate, promote, rerun

After inspecting both responses and satisfying cooldowns, run the following offline block. It prints aggregate counts only. It does not infer unique properties from row count. Unexpected schema/years fail closed. Do not open the CSV in a spreadsheet that coerces keys or executes formulas. The observed `pyear` strings are literally `2026.0`, not silently repaired integers.

```sh
tcad_guard
python3 - <<'PY'
from pathlib import Path
import collections, csv, decimal, hashlib, re, zipfile
names = ('waterfront.csv', 'layouts.zip')
for name, mime, cap in [('waterfront.csv','text/csv',12582912), ('layouts.zip','application/zip',1048576)]:
    p = Path(name + '.part')
    assert p.is_file() and not p.is_symlink()
    assert not Path(name).exists() and not Path(name).is_symlink()
    header = Path(name + '.headers')
    assert header.is_file() and not header.is_symlink()
    h = header.read_text()
    assert re.findall(r'^HTTP/\S+ (\d+)',h,re.M)[-1] == '200'
    assert re.search(r'^content-type:\s*' + re.escape(mime) + r'(?:[;\s]|$)',h,re.I|re.M)
    sizes = re.findall(r'^content-length:\s*(\d+)\s*$',h,re.I|re.M)
    assert len(set(sizes)) <= 1
    assert 0 < p.stat().st_size <= cap
    if sizes: assert p.stat().st_size == int(sizes[0])
with Path('waterfront.csv.part').open(encoding='utf-8-sig',newline='') as f:
    r = csv.reader(f,strict=True)
    assert next(r) == ['pid','pyear','Situs','Effective Front (size)']
    rows = list(r)
assert rows and all(len(r)==4 for r in rows)
assert all(re.fullmatch(r'[0-9]+',r[0]) and r[1]=='2026.0' for r in rows)
assert all(decimal.Decimal(r[3]).is_finite() for r in rows)
with zipfile.ZipFile('layouts.zip.part') as z:
    assert z.namelist() == ['Legacy8.0.33-AppraisalExportLayout.pdf','Legacy8.0.33-AppraisalExportLayout.xlsx']
    assert sum(i.file_size for i in z.infolist()) < 1048576
    assert z.testzip() is None
    assert z.read(z.namelist()[0]).startswith(b'%PDF-')
print('rows',len(rows),'unique pid',len({r[0] for r in rows}),'fields',4)
# Exclusive checkpoint: never regenerate it over an earlier validation.
with Path('VALIDATED.sha256').open('x') as f:
    for name in names:
        f.write(hashlib.sha256(Path(name+'.part').read_bytes()).hexdigest()+'  '+name+'\n')
PY
```

Privately inspect the layout PDF (read only the named member, do not extract arbitrary archive paths) with `pdftotext -layout` and verify the domain explanation above. Retain the original ZIP. The CSV's own header is its verified schema; no independently published waterfront layout was found. Record source/UTC start/end/header version facts privately alongside `VALIDATED.sha256` before promotion.

This final block also recovers interruption between promotions and performs idempotent offline reruns without network. It binds BOTH files to the original validation checkpoint, not newly computed expectations. Keep the owned lock for future checks; do not automatically delete/adopt stale locks.

```sh
tcad_guard
python3 - <<'PY'
from pathlib import Path
import hashlib, re, os
checkpoint = Path('VALIDATED.sha256')
assert checkpoint.is_file() and not checkpoint.is_symlink()
lines = checkpoint.read_text().splitlines()
assert len(lines)==2
pending = []
for line,name in zip(lines,('waterfront.csv','layouts.zip')):
    assert re.fullmatch(r'[0-9a-f]{64}  '+re.escape(name),line)
    final, part = Path(name), Path(name+'.part')
    assert not final.is_symlink() and not part.is_symlink()
    assert final.exists() != part.exists(), 'one matching input required'
    p = final if final.exists() else part
    assert p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==line[:64]
    if p==part: pending.append((part,final))
for part,final in pending:
    os.link(part,final)  # atomic no-clobber publication in this private directory
    part.unlink()
print('verified 2 files; promoted',len(pending))
PY
```

If interrupted between hard-link and unlink, both names exist: stop, verify both against the checkpoint and manually remove only the matching partial under the owned lock, then rerun. Before validation, an interrupted transfer must be restarted in full, never byte-appended: preserve failed headers/partial privately under unique evidence names after inspecting cooldowns, then rerun with fresh fixed names. Missing/wrong hashes or uncertain lock ownership require operator review, not automatic overwrite. A wrong cwd, occupied destination, symlink or missing checkpoint must fail closed.

## Explicitly authorized certified archive

This mode requires separate approval for ONE certified archive GET with a hard compressed cap of 671088640 bytes (640 MiB). The 2026-11-04 approval did not authorize supplemental/JSON bodies or another full-archive GET. First inspect existing private archives/checkpoints for this exact URL/version: reuse any verified original offline, not a new directory to evade deduplication. Reuse retained official page, robots and layout originals when available. Initialize a NEW private snapshot using the same guard/setup above; do not mix this mode with the ancillary snapshot. The operator retains the lock token. All pacing/header-review rules above still apply. This is supervised acquisition, not a network client hidden in a document.

Run metadata-only preflight once, after checking source-wide inactivity/cooldowns. This gate precedes every request/output; checkpoint, attempted GET, occupied path or symlink means STOP, not retry:

```sh
tcad_guard
for file in VALIDATED.sha256 CERTIFIED-GET-ATTEMPT certified.zip certified.zip.part certified.headers certified-head.headers certified-head.body; do
  if test -e "$file" || test -L "$file"; then exit 1; fi
done
sleep 10
curl --disable --silent --show-error --fail --head --connect-timeout 15 --max-time 60 \
  --dump-header certified-head.headers --output certified-head.body \
  'https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip'
```

Privately inspect the HEAD response and all cooldown instructions before continuing. These exact snapshot commands reject changed size/type/version, Retry-After, and every header name containing RateLimit or Rate-Limit (including X- prefixes and Remaining/Reset suffixes) for manual review, rather than guessing or stripping them. Inspect other source-specific cooldown instructions manually too. They require the observed ETag and Last-Modified, not just HTTP 200. Do not bypass denial, redirect, precondition failure or schema drift. Retain UTC start/end and exact command/status privately. The attempt marker is exclusive and is never removed automatically; a failed GET is BLOCKED under this one-GET authorization, not automatically restarted.

```sh
tcad_guard
for file in VALIDATED.sha256 CERTIFIED-GET-ATTEMPT certified.zip certified.zip.part certified.headers; do
  if test -e "$file" || test -L "$file"; then exit 1; fi
done
python3 - <<'PY'
from pathlib import Path
import re
p=Path('certified-head.headers')
assert p.is_file() and not p.is_symlink()
h=p.read_text()
assert re.findall(r'^HTTP/\S+ (\d+)',h,re.M)==['200']
for key,value in [('content-type','application/zip'),('content-length','557228168'),('last-modified','Wed, 22 Jul 2026 12:07:20 GMT'),('etag','"6a60b278-2136a088"')]:
    assert re.findall(r'^'+key+r':\s*(.*?)\s*$',h,re.I|re.M)==[value]
assert not re.search(r'^(?:retry-after|[^:\r\n]*rate-?limit[^:\r\n]*):',h,re.I|re.M), 'manual cooldown review needed'
PY
printf '%s\n' 'one certified GET attempted; do not repeat' > CERTIFIED-GET-ATTEMPT
sleep 10
curl --disable --silent --show-error --fail --connect-timeout 15 --max-time 1800 \
  --speed-limit 1024 --speed-time 60 --max-filesize 671088640 \
  --header 'If-Match: "6a60b278-2136a088"' \
  --dump-header certified.headers --output certified.zip.part \
  'https://traviscad.org/wp-content/largefiles/2026%20Certified%20Appraisal%20Export%20Supp%200_07182026.zip'
```

After complete receipt, privately inspect GET headers/cooldowns too. For offline validation, export `LAYOUT_TEXT` as the canonical absolute path to the retained PDF's `pdftotext -layout` text (original ZIP hash below); never fetch it again just for this check. The following checks metadata before expansion, streams all members for CRC/length integrity with a 1 MiB buffer, caps expansion at 20 GiB total/10 GiB per member and time at 900 seconds, and samples only the first 25 Property rows. It never blindly extracts the roll or loads it into memory. Failure propagates out of the dedicated `set -e` shell with no validation checkpoint. The private sample contains sensitive rows; never publish it.

```sh
tcad_guard
python3 - <<'PY'
from pathlib import Path, PurePosixPath
import decimal, hashlib, os, re, stat, time, zipfile, zlib
for name in ('VALIDATED.sha256','valuation-sample.fixedwidth'):
    assert not Path(name).exists() and not Path(name).is_symlink()
p=Path('certified.zip.part'); hp=Path('certified.headers')
assert p.is_file() and not p.is_symlink() and hp.is_file() and not hp.is_symlink()
assert not Path('certified.zip').exists() and not Path('certified.zip').is_symlink()
h=hp.read_text()
assert re.findall(r'^HTTP/\S+ (\d+)',h,re.M)==['200'] and p.stat().st_size==557228168
for key,value in [('content-type','application/zip'),('content-length','557228168'),('last-modified','Wed, 22 Jul 2026 12:07:20 GMT'),('etag','"6a60b278-2136a088"')]:
    assert re.findall(r'^'+key+r':\s*(.*?)\s*$',h,re.I|re.M)==[value]
with p.open('rb') as f:
    checksum=hashlib.sha256()
    for b in iter(lambda:f.read(1048576),b''): checksum.update(b)
    digest=checksum.hexdigest()
assert digest=='62d0d1cd22b03f31db8d3986160eb181c5d00044df98a303fce9e17a44e9aa02'
layout=Path(os.environ['LAYOUT_TEXT'])
assert layout.is_absolute() and layout.resolve(strict=True)==layout and layout.is_file() and not layout.is_symlink()
fields=[]
for line in layout.read_text().splitlines():
    m=re.match(r'^(\w+)\s+(int|numeric|char|varchar|datetime|date|decimal|bit|filler)\s*(?:\([^)]*\))?\s+(\d+)\s+(\d+)\s+(\d+)\s*(.*)',line)
    if m: fields.append((m[1],m[2],int(m[3]),int(m[4]),int(m[5])))
assert len(fields)==493 and fields[0][2]==1 and fields[-1][3]==9922
assert all(a[3]+1==b[2] for a,b in zip(fields,fields[1:]))
assert all(f[3]-f[2]+1==f[4] for f in fields)
lookup={f[0]:f for f in fields}; started=time.monotonic(); total=0
with zipfile.ZipFile(p) as z:
    infos=z.infolist()
    assert len(infos)==21 and len({i.filename for i in infos})==21
    assert sum(i.file_size for i in infos)<=20*1024**3
    for i in infos:
        n=PurePosixPath(i.filename)
        assert not n.is_absolute() and '..' not in n.parts and '\\' not in i.filename
        assert not i.flag_bits&1 and not stat.S_ISLNK(i.external_attr>>16)
        assert i.compress_type in (0,8) and i.file_size<=10*1024**3
    assert z.getinfo('APPR_HDR.TXT').file_size<=4096
    for i in infos:
        count=crc=0
        with z.open(i) as f:
            while True:
                assert time.monotonic()-started<900
                b=f.read(1048576)
                if not b: break
                count+=len(b); total+=len(b); crc=zlib.crc32(b,crc)
                assert count<=i.file_size and total<=20*1024**3
        assert count==i.file_size and crc==i.CRC
    with z.open('PROP.TXT') as f: rows=[f.readline(9925) for _ in range(25)]
    header=z.read('APPR_HDR.TXT')
assert all(len(r)==9924 and r.endswith(b'\r\n') for r in rows)
for row in rows:
    for name,kind,start,end,length in fields:
        raw=row[start-1:end]; assert len(raw)==length
        if kind in ('int','numeric','decimal') and raw.strip():
            assert re.fullmatch(rb'[+-]?\d+(?:\.\d+)?',raw.strip())
    def text(name):
        f=lookup[name]; return row[f[2]-1:f[3]].decode('ascii').strip()
    assert text('prop_val_yr')=='02026' and text('sup_num')=='000000000000'
    assert all(text(k) for k in ('prop_id','geo_id','py_owner_id'))
    for k in ('appraised_val','assessed_val'):
        value=decimal.Decimal(text(k)); assert value.is_finite() and value>0
with Path('valuation-sample.fixedwidth').open('xb') as f: f.write(b''.join(rows))
with Path('VALIDATED.sha256').open('x') as f: f.write(digest+'  certified.zip\n')
print('CRC verified members',len(infos),'expanded bytes',total,'sample rows',len(rows),'layout fields',len(fields))
PY
```

Preserve string keys exactly, including sample year `02026` and supplement `000000000000`. Do not coerce them to integers in storage; zero has certified meaning per layout, but remains the original string. Selected offsets (one-based inclusive) are `prop_id` 1–12, `prop_val_yr` 18–22, `sup_num` 23–34, `geo_id` 547–596, `py_owner_id` 597–608, `appraised_val` 1916–1930 and `assessed_val` 1946–1960. The PDF's introductory `owner_id` identity is represented by specific owner-related fields; do not invent a single universal owner crosswalk. Preserve raw lines privately as authority. APPR_HDR contains date `07/18/2026` and version-like strings `8.1.33.23` and `8.0.0.33`, different from layout filename `Legacy8.0.33`; their unlabeled semantics are not normalized.

Promote only using the original checkpoint. This separate offline command is safe to repeat without requests, and retains the attempt marker. A crash between hard-link and unlink is deliberately rejected; verify both hashes against the checkpoint, remove only the matching partial manually under the owned lock, then rerun. Never recompute expected hashes from a corrupt/changed body.

```sh
tcad_guard
python3 - <<'PY'
from pathlib import Path
import hashlib, os, re
c=Path('VALIDATED.sha256'); assert c.is_file() and not c.is_symlink()
line=c.read_text(); assert re.fullmatch(r'[0-9a-f]{64}  certified\.zip\n',line)
a,b=Path('certified.zip.part'),Path('certified.zip')
assert not a.is_symlink() and not b.is_symlink() and a.exists()!=b.exists()
p=b if b.exists() else a
assert p.is_file()
with p.open('rb') as f:
    checksum=hashlib.sha256()
    for chunk in iter(lambda:f.read(1048576),b''): checksum.update(chunk)
    assert checksum.hexdigest()==line[:64]
if p==a: os.link(a,b); a.unlink()
print('verified certified archive; no network')
PY
```

The complete 557228168-byte archive SHA-256 is `62d0d1cd22b03f31db8d3986160eb181c5d00044df98a303fce9e17a44e9aa02`. All 21 members passed CRC and length checks (17989848588 expanded bytes streamed, not extracted). The first 25 `PROP.TXT` records matched the retained 493-field/9922-byte layout plus CRLF; all 2825 sampled numeric positions were inspected (2350 nonblank numeric strings checked; blanks retained), with positive appraised/assessed values and certified supplement/year identity. This establishes actual valuation-record acquisition and bounded schema compatibility, NOT all-row data quality, unique-property totals, historical coverage or a Tax Office account crosswalk. No server pagination applies to the ZIP. Supplemental and JSON bodies remain uncollected. Repeated runs must use the retained original, never repeat the GET.

## Verified scope and limits

On 2026-11-04 the complete waterfront report was 287774 bytes, SHA-256 `24eecbe2b6f6605244164945261ce1d5e0b65c6a991541b9ff77da58c0cf0a72`: 5372 four-field rows, 5365 distinct text `pid` values, all literal `pyear=2026.0`. Duplicate property keys are retained, not discarded. Its Last-Modified was 2026-03-27. The 248399-byte layout ZIP SHA-256 was `c51352d2eba2f436c82b88ad156ebcc9a1d9c7fd546aee06bcfc83e69d61535b`; CRC checks and seven-page PDF parsing succeeded. Full-file row counts are local observations; no server total/pagination exists for this CSV.

The waterfront CSV remains an ancillary report, not valuation-roll evidence; the separately authorized certified acquisition above supplies actual valuation rows and supplement identity. No valuation history or Tax Office account crosswalk is claimed. Initial discovery HEADs used two-second spacing before the fetched robots file was inspected; that did not meet its ten-second delay. A draft Bash `set -e`/AND-list guard also allowed one unintended repeat GET of the same waterfront CSV during an occupied-destination test; its hash was unchanged. That was not a second distinct dataset or an additional compliant e2e test. The guard was corrected to explicit `if`/`exit`; network-denying regression tests now verify rejection before requests. All requests after the initial spacing incident used at least ten seconds; future runs must inspect robots first.

Validation/promotion, offline rerun, wrong-cwd/missing-lock/occupied-destination guards, missing/corrupt-checkpoint rejection and interrupted-promotion recovery are exercised privately. Code-only TDD/CRAP/duplication/mutation gates and SQLite integrity are N/A for this supervised skill-only deliverable, not passes. Independent review is a separate chief-owned gate. Do not convert this manual procedure into an unattended client without tests and SQLite run/download/history state.
