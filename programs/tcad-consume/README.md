# TCAD offline certified Property importer

Bun/TypeScript + SQLite. There is deliberately NO HTTP adapter, sync command, robots fetch or future download permission. TCAD is a separate appraisal district, not the County Tax Office.

Only this explicit selection is supported: `2026-certified-supp0-property-first25`, exactly 25 first `PROP.TXT` records, from the retained certified original and retained layout ZIP. Publication URLs/labels and pinned hashes are in `src/source.ts`; the archive hash is `62d0d1cd22b03f31db8d3986160eb181c5d00044df98a303fce9e17a44e9aa02`, layout hash `c51352d2eba2f436c82b88ad156ebcc9a1d9c7fd546aee06bcfc83e69d61535b`. Other hashes/selections fail closed; no silent expansion to another roll/year/supplement/JSON format.

Requires Bun and Poppler `pdftotext` on PATH. From this program directory:

    bun install --frozen-lockfile
    bun src/cli.ts list
    bun src/cli.ts inventory --selection 2026-certified-supp0-property-first25 --archive "$RETAINED_ARCHIVE"
    bun src/cli.ts import --selection 2026-certified-supp0-property-first25 --rows 25 --archive "$RETAINED_ARCHIVE" --layout "$RETAINED_LAYOUT" --output "$ARCHIVE"
    bun src/cli.ts status --output "$ARCHIVE"
    bun src/cli.ts verify --output "$ARCHIVE"

The three environment variables are non-resolving operator-supplied placeholders for canonical absolute paths. Original inputs are read only, never extracted, renamed or overwritten. Outputs must be outside every checkout, in one private mode-0700 owned archive root. The shared exclusive writer lock covers this root, not arbitrary concurrent alternative roots. Stale locks require operator inspection and proof that the recorded writer is dead before removal; never adopt another writer's token. Original external input references remain necessary for future verification: retain originals at their registered paths.

SQLite stores exact source URLs/labels, source-version hashes, observations, import/reuse/failure/interruption runs, immutable sample download/checkpoint status, field definitions by position, archive inventory, raw header bytes, and every selected Property row's ordinal, member, keys, original field strings and rejection reason. PK is version/member/ordinal, NOT property ID. The 23 repeated `filler` field names are preserved by positional array, not overwritten in a name-keyed map. Raw sample bytes are private; original archive/layout remain in the operator's external retained archive. Observation time is not the unknown original retrieval/publication date; these dates remain NULL. APPR_HDR version-like strings are preserved separately from the layout filename `Legacy8.0.33`, not normalized.

Version success requires both pinned original hashes, bounded ZIP inventory, actual layout PDF parsing, 493 contiguous fields covering bytes1–9922, and exactly25 raw lines of 9922 bytes plus CRLF. Numeric positions are validated as strings without binary floats; the original year `02026` and supplement `000000000000` are retained. Owner/property/geographic keys are not coerced. Selected row rejections are explicit and retained, never dropped. No Tax Office account crosswalk is invented.

Sample promotion is validated, atomic and no-clobber. A synced sample hash checkpoint can recover a pending-only promotion after restart; both final and pending names, a mismatching hash, or an uncertain lock requires operator review. A crash before a checkpoint leaves staging/interrupted evidence, never a complete version. Duplicate imports rehash originals and verify existing content/SQLite/source/version/member/run/download relationships before deterministic reuse. Verify issues zero HTTP and does not repeat the roll's full18GB decompression.

ZIP limits: 640 MiB compressed archive, 1 MiB compressed layout, 64 members, 20 GiB total declared/actual expansion, 10 GiB per member, safe relative paths, no symlink/special/encrypted/unsupported-method members. Read-only central-directory inventory is not a CRC claim. Buffered selected reads are capped at1 MiB; Property import reads just a248100-byte prefix (plus bounded stream chunk slack). Header is capped at4096 bytes. Full selected small members check CRC/length. Native Bun stored-member streams are consumed with data/end events: a synthetic stored ZIP exposed a legacy fd-slicer EOF/async-iterator hang; the regression now completes and rejects CRC corruption.

A separately explicit expensive integrity operation streams ALL members without buffering/extraction:

    bun src/cli.ts integrity --selection 2026-certified-supp0-property-first25 --archive "$RETAINED_ARCHIVE" --max-expanded 21474836480 --max-seconds 900

Do not run this by default. Prior retained evidence already verified all21 members /17989848588 expanded bytes; implementation tests deliberately did NOT repeat that full18GB pass. The integrity engine was exercised against both retained layout members and synthetic stored-member CRC corruption. Selected-prefix import is not whole-member Property CRC verification or all-row semantic quality.

Verification results: retained certified archive557228168 bytes;21-member inventory;493 layout fields;25 selected rows /248100 raw bytes /0 rejections; literal certified year/supplement reproduced. Import, duplicate reuse and SQLite/content offline verify succeeded, version `f5033ef448bf6a9c4cbb0e1bcc1dd3b717e1384b2e8c465a14a32155e01ce1d5`. No source requests, including robots, were made. This is explicitly partial coverage, not unique-property totals, full-roll semantics, holdings/history completeness, or supplemental/JSON acquisition.

Tests:

    bun test
    TCAD_INPUTS="$RETAINED_INPUT_HANDOFF" bun test --coverage --coverage-reporter=lcov --coverage-reporter=text
    bun run typecheck

`RETAINED_INPUT_HANDOFF` is a private JSON with `archive`, `layout`, `archive_sha256`, `layout_sha256`. Without it, original-byte integration tests are skipped explicitly; a skipped suite is not original-byte verification. With the retained handoff, all11 tests pass. Own loaded-source lines are100% covered (not a claim about every branch); shared imports lower the aggregate. Measured own-function CRAP maximum9, all strictly below10; dryer no >=0.8 candidates. Focused mutation of ZIP safe-path/member-metadata/inventory bounds executed31 sites,31 killed /0 survivors /0 uncovered, after an unchanged-worker baseline passed. The module has additional unselected sites; this is not whole-module mutation coverage. Independent fresh review, integration and acceptance remain chief-owned.
