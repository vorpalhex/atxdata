# Tax Office bounded bulk access

Intent: an agent-supervised, anonymous curl procedure for a small, complete delinquency snapshot and its published layout. LLM-authored contribution. This is not a new client, scheduler, historical backfill, or TCAD connector. Keep all raw records, headers (which can contain cookies), checksums and validation output in an operator-approved private archive outside the checkout. Never publish owner/account-level rows.

## Official discovery and scope

Start at https://tax-office.traviscountytx.gov/pages/property.php and recheck the links and advertised sizes before each new snapshot. On 2026-11-04 it described business-day refreshes and linked:

| Resource | URL relative to `https://tax-office.traviscountytx.gov` | Verification |
| --- | --- | --- |
| Delinquent CSV | `/voterdata/TaxDelqOpenData.csv` | Full small file acquired |
| Delinquent Excel | `/voterdata/TaxDelqOpenData.xlsx` | Linked only |
| Current year and prior delinquency CSV | `/voterdata/TaxCurOpenData.csv` | Linked only; advertised 248.17 MB, not downloaded |
| Current/prior Excel ZIP | `/voterdata/TaxCurOpenData.zip` | Linked only; advertised 195.21 MB, not downloaded |
| Delinquency layout | `/pages/DelinquentFileLayout.php` | Full PDF acquired |
| Current/prior layout | `/pages/CurrentFileLayout.php` | PDF acquired; roll compatibility untested |
| Rates and exemptions | `/pages/2025RatesExemptions.php` | Linked only |
| Rates history | `/pages/2025RatesHistory1990-2025.php` | Linked only |

Links are mutable: these are not immutable annual archives. The tested delinquency file was advertised as 1.61 MB and modified November 3, 2026. That bounded full file is preferable to sampling an enormous roll. The landing page did not enumerate a historical snapshot archive. Neither the current/prior roll nor the Excel alternatives were acquired. A separate account-search service is real-time; do not substitute its results for a dated bulk snapshot.

## Supervised transfer protocol

Prerequisites: Bash, curl, Python 3, `pdftotext`, and an operator-approved existing empty private snapshot directory (mode 0700, owned by the current user). Set and export `ARCHIVE` to its canonical absolute path; it is a placeholder, not a repository-relative output path. Do not create a replacement directory when it is missing. Use a new directory per acquisition date/version. Commands below run in the same dedicated Bash session; failures stop that session, not merely print warnings. Never continue to a later block after an error.

First load these safety helpers (also load them in a new shell for offline reuse/recovery). They do not create files. Every output-producing block checks the destination, current directory and snapshot lock before writing:

```sh
set -eu
umask 077
tax_guard() {
  python3 - "${1:-active}" <<'PY'
import os, pathlib, sys
raw = os.environ.get("ARCHIVE", "")
assert raw and pathlib.Path(raw).is_absolute(), "export an absolute ARCHIVE"
root = pathlib.Path(raw).resolve(strict=True)
assert str(root) == raw and root.is_dir(), "require canonical existing directory"
assert root.stat().st_uid == os.getuid() and not root.stat().st_mode & 0o077
assert not any((p / ".git").exists() for p in (root, *root.parents)), "no checkout output"
mode = sys.argv[1]
if mode == "setup":
    assert not list(root.iterdir()), "new snapshot directory must be empty"
else:
    assert pathlib.Path.cwd().resolve() == root, "wrong working directory"
    lock = root / ".acquisition-lock"
    if mode == "reuse":
        assert not lock.exists(), "incomplete or active snapshot"
    else:
        assert lock.is_dir() and not lock.is_symlink()
        owner = lock / "owner"
        assert owner.is_file() and not owner.is_symlink()
        identity = os.environ.get("TAX_LOCK_ID", "")
        assert identity and owner.read_text().strip() == identity, "not this shell's lock"
PY
}
```

For a new acquisition only, initialize the empty destination. `tax_guard setup` must succeed before `cd` or any write. This lock protects only this snapshot directory; it does NOT serialize different dated directories or enforce a source-wide rate limit. The supervising operator must permit only one active Tax Office acquisition across all directories/shells and preserve the longest source cooldown. Do not automatically remove/adopt a stale lock.

```sh
set -eu
umask 077
tax_guard setup
cd -- "$ARCHIVE"
mkdir .acquisition-lock
TAX_LOCK_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
export TAX_LOCK_ID
printf '%s\n' "$TAX_LOCK_ID" > .acquisition-lock/owner
tax_guard
```

Privately retain this shell's `TAX_LOCK_ID` for recovery; never read/adopt another shell's owner token automatically. Each later block fails if called without the helpers, at the wrong cwd, or without the matching owner token.

For every request below, including retries and discovery:

- Make just one request at a time, including full-body receipt. Leave at least two seconds after completion before starting another request, including in another shell. Do not parallelize, use range requests, or automatically follow redirects.
- Save headers and body separately with fixed local filenames; never trust a server-provided filename. Review the HTTP status and all headers privately before the next request. Stop on redirects, login/challenge HTML, HTTP 401/403/404, unexpected schema, or quota instructions you cannot interpret. Do not bypass access controls.
- Honor all published source quotas. On every response, including HTTP 200, wait at least `Retry-After` (seconds or HTTP date, relative to server Date where supplied); also honor exhausted `RateLimit-Remaining`/`RateLimit-Reset` (seconds), `X-RateLimit-*` epoch resets, and structured `RateLimit` policies such as `r=0;t=...`. Use the longest applicable cooldown or two-second pacing, never a shorter cap. If the delay exceeds the session, stop and record the not-before time privately for the next operator.
- At most three retries after the initial request, only for HTTP 408/409/425/429/5xx or transient connection/body timeout failures. Before retry number n (1–3), wait the longer of server cooldown, pacing, and `0.5 * 2**(n-1) + U(0,0.25)` seconds. Stop with the actual error after the budget. These commands deliberately have no automatic retry: the supervising agent must inspect successful-response cooldowns too.
- The curl time limit covers the full body. `--disable` must be curl's first argument: default curlrc configuration is suppressed so redirects, retries, extra URLs, credentials or cookies cannot bypass the manual request gate. Size ceilings are safety limits, not truncation targets: a size-limit failure is not an acquired sample. A transfer failure must never promote a `.part` file.

Check applicable source instructions first. In the verification, `/robots.txt` returned 302 to `/404`; it supplied no crawl instructions and was not followed. No numeric quota or cooldown header was observed on the tested download responses; that is not a guarantee about future requests.

Fetch discovery using this exact bounded command, inspect its headers/body and the current links, then apply the protocol before continuing:

```sh
set -eu
tax_guard
curl --disable --silent --show-error --fail --connect-timeout 15 --max-time 60 \
  --max-filesize 2097152 --dump-header property.headers \
  --output property.html.part \
  https://tax-office.traviscountytx.gov/pages/property.php
```

Require HTTP 200 and actual bulk/layout links, not a challenge page. After private inspection, accept discovery with this guarded block:

```sh
set -eu
tax_guard
python3 - <<'PY'
from pathlib import Path
import re
header = Path("property.headers").read_text()
assert re.findall(r"^HTTP/\S+ (\d+)", header, re.M)[-1] == "200"
body = Path("property.html.part").read_text()
assert "/voterdata/TaxDelqOpenData.csv" in body and "DelinquentFileLayout.php" in body
assert not Path("property.html").exists()
Path("property.html.part").rename("property.html")
PY
```

Fetch the two required resources separately, inspecting headers/cooldowns between commands:

```sh
set -eu
tax_guard
curl --disable --silent --show-error --fail --connect-timeout 15 --max-time 60 \
  --max-filesize 2097152 --dump-header delinquent-layout.headers \
  --output delinquent-layout.pdf.part \
  https://tax-office.traviscountytx.gov/pages/DelinquentFileLayout.php
```

```sh
set -eu
tax_guard
curl --disable --silent --show-error --fail --connect-timeout 15 --max-time 90 \
  --max-filesize 4194304 --dump-header delinquent.headers \
  --output delinquent.csv.part \
  https://tax-office.traviscountytx.gov/voterdata/TaxDelqOpenData.csv
```

Require HTTP 200, `text/csv` for the CSV, and verify Content-Length when supplied. The layout is a PDF attachment served as `application/octet-stream`; a PHP URL or generic MIME type is not proof of HTML. Require `%PDF-` signature and inspect PDF text against the columns below before accepting. Retain source URLs, UTC retrieval start/end, HTTP Date, Last-Modified, size, hashes, schema and validation outcome together in the private archive. Do not treat Last-Modified as a certified tax-roll year, or HTTP Date as an individual account update time.

## Validate before promotion

Run this shell block after successful transfers. It invokes Python explicitly, checks statuses/MIME/lengths, and extracts PDF text privately. It prints only aggregate counts. The expected column list intentionally retains the live header's trailing space. Schema drift fails closed. The checkpoint binds exactly the two validated inputs before any promotion; it is not the completed snapshot manifest.

```sh
set -eu
tax_guard
pdftotext -layout delinquent-layout.pdf.part .acquisition-lock/layout.txt
python3 - <<'PY'
import csv, datetime, decimal, hashlib, pathlib, re
root = pathlib.Path.cwd()
names = ("delinquent.csv", "delinquent-layout.pdf")
for name, header_name in zip(names, ("delinquent.headers", "delinquent-layout.headers")):
    path = root / (name + ".part")
    assert path.is_file() and not path.is_symlink() and not (root / name).exists()
    header = (root / header_name).read_text()
    blocks = re.split(r"(?m)(?=^HTTP/)", header)
    header = [block for block in blocks if block.startswith("HTTP/")][-1]
    assert re.match(r"HTTP/\S+ 200(?:\s|$)", header)
    lengths = re.findall(r"^content-length:\s*(\d+)\s*$", header, re.I | re.M)
    assert len(set(lengths)) <= 1
    if lengths:
        assert path.stat().st_size == int(lengths[0]), "Content-Length mismatch"
    if name.endswith(".csv"):
        assert re.search(r"^content-type:\s*text/csv(?:[;\s]|$)", header, re.I | re.M)
    print(name, "bytes:", path.stat().st_size, "length checked:", bool(lengths))
assert (root / "delinquent-layout.pdf.part").read_bytes().startswith(b"%PDF-")
expected = ["Account #", "Last Tax Roll Year ", "Property Type Code", "Land Value",
    "Improvement Value", "Ag Market", "Appraisal Value", "Ag Taxable Value",
    "Assessed Value", "Exemptions", "Delinquent Total", "Current Year Total",
    "Total Due", "Sequence #", "1st Year Delinquent", "Cause #", "Judgement Date",
    "Bankruptcy Number", "Owner ID", "Owner Name", "Address 1", "Address 2",
    "Address 3", "City", "State", "Zip Code", "Country", "Street Number",
    "Street Name", "Property Zip", "Legal Description"]
with (root / "delinquent.csv.part").open(encoding="utf-8-sig", newline="") as source:
    reader = csv.reader(source, strict=True)
    assert next(reader) == expected
    rows = list(reader)
assert rows and all(len(row) == 31 for row in rows)
accounts = [row[0] for row in rows]
assert all(re.fullmatch(r"[0-9]{14}", value) for value in accounts)
assert len(set(accounts)) == len(accounts)
for row in rows:
    assert re.fullmatch(r"[0-9]{4}", row[1])
    assert not row[14] or re.fullmatch(r"[0-9]{4}", row[14])
    for index in [3, 4, 5, 6, 7, 8, 10, 11, 12, 13]:
        assert decimal.Decimal(row[index]).is_finite()
    assert decimal.Decimal(row[13]) == int(decimal.Decimal(row[13]))
    assert decimal.Decimal(row[10]) + decimal.Decimal(row[11]) == decimal.Decimal(row[12])
    if row[16]:
        datetime.datetime.strptime(row[16], "%m/%d/%Y")
print("validated data rows:", len(rows), "columns:", len(expected))
checkpoint = root / ".acquisition-lock" / "VALIDATED"
assert not checkpoint.exists(), "do not replace earlier validation evidence"
text = "".join(hashlib.sha256((root / (name + ".part")).read_bytes()).hexdigest()
               + "  " + name + "\n" for name in names)
temporary = checkpoint.with_suffix(".part")
with temporary.open("x") as target:
    target.write(text)
temporary.rename(checkpoint)
PY
```

Privately read `.acquisition-lock/layout.txt` and compare field order/meaning with the schema. Only after this manual PDF/schema review succeeds, run the following exact finalization block. It requires BOTH checkpoint entries and BOTH matching inputs before any rename; previously promoted files must match the original checkpoint, never newly generated hashes. Each rename is atomic but the two-file operation is not a transaction.

```sh
set -eu
tax_guard
python3 - <<'PY'
from pathlib import Path
import hashlib, re
names = ("delinquent.csv", "delinquent-layout.pdf")
checkpoint = Path(".acquisition-lock/VALIDATED")
assert checkpoint.is_file() and not checkpoint.is_symlink()
lines = checkpoint.read_text().splitlines()
assert len(lines) == len(names)
expected = {}
for name, line in zip(names, lines):
    match = re.fullmatch(r"([0-9a-f]{64})  " + re.escape(name), line)
    assert match, "require exactly both expected artifacts, in order"
    expected[name] = match[1]
assert not Path("SHA256SUMS").exists() and not Path("SHA256SUMS").is_symlink()
assert not Path("SHA256SUMS.part").exists(), "inspect/quarantine incomplete manifest first"
assert not Path(".validation").exists()
for name in names:
    final, partial = Path(name), Path(name + ".part")
    assert final.exists() != partial.exists(), "exactly one candidate per artifact"
    candidate = final if final.exists() else partial
    assert candidate.is_file() and not candidate.is_symlink()
    assert hashlib.sha256(candidate.read_bytes()).hexdigest() == expected[name]
for name in names:
    final, partial = Path(name), Path(name + ".part")
    if not final.exists():
        partial.rename(final)
for name in names:
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected[name]
with Path("SHA256SUMS.part").open("x") as target:
    target.write(checkpoint.read_text())
assert Path("SHA256SUMS.part").read_text().splitlines() == lines
Path("SHA256SUMS.part").rename("SHA256SUMS")
# Release only after every earlier operation succeeded; retain validation evidence.
Path(".acquisition-lock").rename(".validation")
print("complete snapshot: both artifacts verified; lock released")
PY
```

Offline reuse (no setup or requests): load the helper block, export the existing canonical `ARCHIVE`, explicitly `cd` there, then execute this block. A passing one-entry manifest is NEVER sufficient:

```sh
set -eu
tax_guard reuse
python3 - <<'PY'
from pathlib import Path
import hashlib, re
names = ("delinquent.csv", "delinquent-layout.pdf")
manifest = Path("SHA256SUMS")
assert manifest.is_file() and not manifest.is_symlink()
assert not Path("SHA256SUMS.part").exists()
lines = manifest.read_text().splitlines()
assert len(lines) == len(names)
for name, line in zip(names, lines):
    match = re.fullmatch(r"([0-9a-f]{64})  " + re.escape(name), line)
    assert match, "exact two-artifact manifest required"
    path = Path(name)
    assert path.is_file() and not path.is_symlink() and not Path(name + ".part").exists()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == match[1]
print("reuse: both artifacts verified; no HTTP required")
PY
```

On ANY error, stop: retain the lock, headers, checkpoint and original final files. Never regenerate a manifest from whichever files happen to exist. After an interruption between promotions, first establish that no writer is active; use the original privately retained owner token, load helpers and `cd` to the same canonical archive, then rerun only the finalization block. Its checkpoint check accepts one already-promoted file only if it matches the original validation hash, and verifies the remaining partial before promotion. If checkpoint is missing/malformed, an input differs, or provenance is uncertain, quarantine the snapshot and restart in a new approved empty directory; do not bless existing finals by re-hashing them. A leftover `SHA256SUMS.part` is not trusted: after ownership review, retain/quarantine it outside the snapshot before re-running finalization against the original checkpoint. If the final manifest exists but the lock remains, inspect the failed release manually; do not call that snapshot reusable or automatically remove the lock.

Never overwrite a completed snapshot. Remove only known incomplete download partials before full byte-zero retry, retaining failed headers separately; never delete checkpointed inputs as a retry shortcut. There is no byte-range resume because the mutable source may change between ranges. This manual skill has no SQLite/session database and is not an automatic download-run client.

## Schema interpretation and verification evidence

Verified 2026-11-04 UTC, with serial full-body requests more than two seconds apart:

- Delinquent CSV: 1,686,109 bytes, HTTP Content-Length matched, 7,285 data rows plus header, exactly 31 fields per row; all account IDs unique 14-digit text. SHA-256 `82fb6c4c190d26d3da751f54d1f08d18f62e46024842d390dc4c5cf956dea9e4`.
- CSV HTTP Last-Modified: `Tue, 03 Nov 2026 15:18:35 GMT`. Snapshot is a mutable full delinquency export, not a complete yearly tax roll. No API pagination or external row-count total was supplied: count is the parsed complete response only.
- Delinquency layout PDF: 70,173 bytes, `%PDF-1.7`, SHA-256 `d7df7585a9a2381b115beb708df64ca2072138d18947544d9afcb04b8a68537a`. Its 31 field descriptions align positionally with CSV aliases, but its explanatory text still refers to 2012. Do not promote that example year to current coverage or infer that schema freshness is guaranteed.
- Last Tax Roll Year ranged 2006–2025; positive first-delinquent years ranged 1990–2024. First-delinquent year also had blanks and `0000`. These are observed column ranges, not proof that every intervening year's records are present. All 114 nonblank judgment dates parsed as month/day/four-digit-year; 7,171 were blank.
- Value/balance columns parsed as finite decimals; sequence count parsed as integral. Delinquent Total + Current Year Total equaled Total Due in every row. Use decimal money, not binary floating point. Account numbers must remain text, retaining leading zeroes.
- The layout defines delinquent total as all jurisdictions/all years including penalties, fees and interest; Current Year Total is not yet delinquent. Sequence count is not a count of years (payment plans/rollbacks may create multiple sequences). Cause number alone does not prove a suit was filed. Appraisal, assessed, agricultural and land/improvement values are separate fields, not balances; this export is not the TCAD certified appraisal roll.

Recovery verification used a deliberately truncated private `.part`, a fresh full retransfer and a matching SHA-256; checksum reuse skipped HTTP, and a deliberately corrupted private copy failed verification. These establish full-restart and immutable-local-reuse behavior, not byte resume, durable automatic retries, or historical completeness. Subsequent offline remediation used real private copies with zero new public requests: original failed-directory/missing-PDF commands reproduced false success (RED); revised exact setup, discovery acceptance, Python/PDF/length validation, finalization and reuse blocks ran successfully. Negative checks rejected unset/missing/nonprivate/checkout destinations, wrong cwd/owner, lock contention, missing artifacts, one-entry checkpoint/manifests and changed promoted finals. Injected second-rename, manifest-rename and lock-release failures retained the lock and failed; checkpoint-bound interrupted promotion and explicitly quarantined temporary-manifest recovery succeeded. This is supervised snapshot-local recovery, not source-wide locking.

Quality scope: no production client was added, so production-client CRAP/dryer/mutator metrics, typecheck and SQLite integrity are N/A, not passed. Executable shell/Python documentation is NOT exempt from behavior checks: reviewer reproductions were tested RED before repair, and 32 offline positive/negative remediation checks passed on real copies. All nine shell blocks passed syntax checks; offline blocks were also executed exactly, not merely syntax-checked. Live curl success was already evidenced by the original acquisition; no new remediation download was needed. Independent re-review/acceptance remains chief-owned and is not claimed here.
