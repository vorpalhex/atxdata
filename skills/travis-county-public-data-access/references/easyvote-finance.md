# EasyVote: Supervised Public Filing Acquisition

Browser prerequisite: agent-browser is an optional external CLI, not a private skill supplied by this repository. Follow [installation, private-session setup and the smoke test](browser-setup.md) before using its commands. Install with `brew install agent-browser` on macOS or `npm install -g agent-browser`, then run `agent-browser install` and `agent-browser skills get core` through the terminal tool. An ordinary human browser or another approved control tool can perform equivalent UI steps; preserve this procedure's scope and stopping rules.

Intent: collect a bounded modern campaign-finance filing through the ordinary public browser interface, preserving original source-delivered PDF bytes and filing identity. This is not an API client, filing/submission tool, transaction parser or complete finance archive.

## Official source and state

Start with [VoteTravis campaign finance](https://votetravis.gov/candidates-office-holders/campaign-finance/) and its [Travis County Easy Campaign Finance portal](https://traviscountytx.easyvotecampaignfinance.com/). The county page advertises EasyVote for November 11, 2021–Present and legacy records for January 1, 1997–November 11, 2021. Those overlapping labels do not prove an exclusive transition boundary or complete holdings.

An earlier direct anonymous-reader bootstrap returned HTTP 500. A later normal agent-browser session successfully loaded Public Filings and acquired a real original PDF without login, registration, identity fabrication, API replay or alternate endpoints. Preserve the earlier service failure as history, not a current universal access prohibition. Optional Register/Login navigation is separate from public viewing.

## Browser procedure

Load the general `agent-browser` skill and the installed version's core instructions through the terminal tool. Use a unique named task session, an explicit reviewed config and a fresh private output directory outside the repository. Do not attach personal browser profiles or persist cookies without approval. The current source works in locally managed Chrome; no hosted service is required.

```sh
agent-browser --config "$CONFIG" --session "$SESSION" open 'https://traviscountytx.easyvotecampaignfinance.com/'
agent-browser --config "$CONFIG" --session "$SESSION" wait --text 'Public Filings for Travis County'
agent-browser --config "$CONFIG" --session "$SESSION" snapshot -i
```

Initial navigation can briefly show no interactive elements. Wait for visible public content, not generic network idle. If a service error, login requirement or challenge persists, preserve the actual observation and stop rather than guessing reader identities or probing alternative routes. Normal browser assets/background traffic are permitted; searches remain deliberate and downloads polite.

1. Choose ONE real public filer from the displayed index; do not select apparent test records merely because they exist. The grid's currently rendered rows are not a proven complete filer census. Keep index captures and person-level fields private.
2. Expand that filer's row using the actual expander. Refresh the snapshot; the child grid exposes Document Name, Date Submitted, Document Type and Election. Preserve those original strings and the chosen parent filer/office association privately.
3. Choose ONE actual report in the agreed scope. Double-click its document-name cell. In the verified observation, a single click did not open it; a double-click opened a new browser PDF blob tab. Do not repeatedly click or infer non-filing from absent results.
4. List tabs privately and identify the newly opened PDF tab. Record the selected filing metadata before switching away. Do not log opaque blob identifiers or all unrelated browser tabs.

```sh
agent-browser --config "$CONFIG" --session "$SESSION" dblclick "$REPORT_CELL_REF"
agent-browser --config "$CONFIG" --session "$SESSION" tab list --json
```

Refs and tab IDs must come from this live session, not copied examples. A document label such as COH and Date Submitted are not by themselves a reporting period, amendment identity or globally unique document key. Verify those against the actual file. Preserve amendments as separate observations/files when exposed; never overwrite a prior filing on a matching name or period. Amendment enumeration was not verified by this sample.

## Preserve the actual browser-delivered PDF

Prefer the viewer's source download control if exposed. Do NOT use `agent-browser pdf` or browser Print to fabricate an “original filing”: those generate a new rendering rather than preserve delivered bytes.

In the verified route, the viewer opened a same-origin `blob:` URL created by the public portal. From its creating Public Filings tab, the browser can read that exact already-created Blob and return its bytes. This is local browser-object extraction, not a new external API request or replay of hidden headers. A blob URL is session-local, temporary, and not a citable durable source ID. Preserve the stable portal URL, filer/list metadata, observation time and actual file hash instead.

For this method only, use `agent-browser eval --stdin` with the following expression after substituting `BLOB_URL_JSON` with the safely JSON-encoded URL actually observed in the current task. Never guess it, reuse an expired blob or accept an arbitrary external URL. Use the creating tab whose origin matches the blob; keep values private. The 12 MiB ceiling is a bound for reading the already-delivered Blob, NOT a network download ceiling enforced before the UI opens it.

```javascript
(async () => {
  const u = BLOB_URL_JSON;
  if (!u.startsWith('blob:' + location.origin + '/')) throw new Error('wrong blob origin');
  const r = await fetch(u);
  if (!r.ok) throw new Error('blob read failed');
  const b = await r.blob();
  if (!b.size || b.size > 12582912) throw new Error('blob size cap');
  const bytes = new Uint8Array(await b.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return {size: b.size, type: b.type, base64: btoa(binary)};
})()
```

Capture subprocess stdout privately, never print the base64 body or raw filing fields into routine logs. Parse the CLI response (unwrap a JSON string if necessary), strictly decode base64, and require decoded length equal to `size`, PDF MIME and `%PDF-` signature. Save with exclusive creation (`O_CREAT|O_EXCL`, mode 0600 or equivalent) under a canonical private directory; an existing file, resolving symlink or dangling symlink must fail before output overwrite. Retain failed/partial receipts as unvalidated evidence, never a successful filing. Do not launch another report merely to repair a local capture error while the existing blob is still available.

Record a SHA-256 and recheck the saved bytes offline. Use pdfinfo/qpdf to validate actual structure and count; a successful text-extractor exit is NOT proof of readable content. If text is empty/garbled, render the cover and required identity/period/final pages privately and inspect them. Preserve the file unchanged; rendered PNGs and extracted text are derivative evidence, not replacements for original bytes. No person-level donation/address/birthdate/signature content belongs in committed documentation or fixtures.

A no-request reuse verifies the retained hash and document identity/page count. A later remote observation must use a fresh filename and timestamp; do not call offline reuse a freshness check. This supervised workflow adds no client database, unattended retry/resume protocol or bulk enumeration. Blob extraction failure must not trigger guessed PDF APIs, header/token replay or altered permissions.

## Actual bounded verification

Agent-browser 0.41.2 with locally managed Chrome loaded Public Filings anonymously. One real filer was expanded and one COH row dated 07/15/26 was double-clicked. Its source-delivered PDF was preserved from the browser Blob:

- 634862 bytes; application/pdf; PDF 1.4; eight physical pages.
- SHA-256 `76c42c99405bf8686fc93aa0f22546f130d11d90b5fcde1b0fa1645ff54dabb2`.
- pdfinfo and qpdf checks exited 0. pdftotext exited 0 but produced no readable text; no extracted-text success was claimed.
- Rendered physical pages 1, 2 and 8 were inspected. The first is Form UD, the next is the C/OH cover; filer identity matches the selected public row. July 15 report is checked, covering January 1 through June 30, 2026. Seven pages declared on the C/OH cover plus its preceding UD declaration reconcile the eight-page PDF. Final Schedule F1 identifies the same filer.
- This is identity/period/physical-page reconciliation, not an audit of transaction accuracy, redaction quality or every interior page. The exact report count and whole-source completeness were not established. No amendment, structured transaction export, full history or universal anonymous-access guarantee is claimed.

The full public filer list loaded as normal browser UI metadata; only one filer's report and one PDF were selected. No donor/payee harvesting or personal financial disclosure request was made. Raw source PDF, visual renders, list snapshots, blob identifiers and detailed receipts stay private. The owned browser session was closed after validation.

Code-only Bun/SQLite integrity, production TDD, CRAP, duplication and mutation metrics are N/A, not passing measurements: no production client is added. The deliverable is this supervised acquisition skill; fresh independent review must verify the actual source evidence, privacy/scope distinctions and published method before acceptance.
