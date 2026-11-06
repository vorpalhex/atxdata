# Solicitation Search: Supervised Metadata Access

Browser prerequisite: agent-browser is an optional external CLI, not a private skill supplied by this repository. Follow [installation, private-session setup and the smoke test](browser-setup.md) before using its commands. Install with `brew install agent-browser` on macOS or `npm install -g agent-browser`, then run `agent-browser install` and `agent-browser skills get core` through the terminal tool. An ordinary human browser or another approved control tool can perform equivalent UI steps; preserve this procedure's scope and stopping rules.

## Capability and source

Official source: <https://purchasingtransparency.traviscountytx.gov/public/search/solicitations>.

This is a verified, bounded, anonymous browser workflow for procurement opportunity metadata and its displayed detail view. It is not an API client, bulk solicitation archive, original-document downloader, or revision-history collector. Access difficulty is medium for the county search; the sampled outbound BidNet full-solicitation link reached an SSO login and remains a separate unresolved document-access boundary.

Use the general `agent-browser` skill and load the installed version's core instructions before operation. The exercised installation was agent-browser 0.41.2 with local managed Chrome. No hosted browser, operator profile, restored cookies, registration, or payment was used. Normal Blazor assets, SignalR and browser concurrency are allowed; standalone API-client serialization rules do not apply to browser internals. Keep navigation/search deliberate and downloads polite. Stop at challenges, cooldowns, export denial, login or identity gates; do not reconstruct private endpoints or connection tokens.

## Private setup and bounded scope

Resolve `EVIDENCE` to a fresh, canonical, private directory outside the checkout through the operator's approved scratch facility. Reject occupied directories and symlinks; use directory mode 0700. Create a fresh private downloads subdirectory and an explicit reviewed configuration there using file-writing tools. The exercised configuration contained `headed: true` and `downloadPath` pointing to that private downloads directory. Resolve `CONFIG` to this file and derive `SESSION` with:

```sh
agent-browser --version
agent-browser skills get core
agent-browser session id --scope worktree --prefix tc-solicitations-final
```

Pass the returned literal session name and configuration on every browser command. Do not use the shared default, auto-connect, restore/state options, copied profiles, or cookie imports. Clear inherited browser-provider/profile/plugin/init-script environment overrides before launching; explicit configuration replaces default project/user discovery, but environment overrides can still apply.

The authorized discovery ceiling in this verification was one visible result page, at most 50 rows. The actual initial ACTIVE view displayed seven rows, page size 25, `1-7 of 7`, with four disabled pagination buttons. All seven rows count as exposed metadata, not merely the selected row. No discovery paging, broad wildcard, status change, or date-range search was performed. Fresh-session startup exposed the same seven-row default again; these repeated exposures are not new historical enumeration. Never assume this default remains within a future acquisition cap: check visible counts immediately and stop rather than paging if scope is exceeded.

## Exercised search actions

```sh
agent-browser --config "$CONFIG" --session "$SESSION" open 'https://purchasingtransparency.traviscountytx.gov/public/search/solicitations'
agent-browser --config "$CONFIG" --session "$SESSION" snapshot -i
agent-browser --config "$CONFIG" --session "$SESSION" wait --fn "document.querySelectorAll('thead th').length===5 && document.querySelectorAll('tbody tr').length>0"
agent-browser --config "$CONFIG" --session "$SESSION" find label Search fill '275-CO'
agent-browser --config "$CONFIG" --session "$SESSION" press Tab
agent-browser --config "$CONFIG" --session "$SESSION" wait --fn "document.querySelectorAll('tbody tr').length===1 && document.querySelector('tbody').innerText.includes('275-CO')"
```

`275-CO` was selected from the actual discovery page, not invented. Keep ACTIVE selected and both Published After/Published Before empty. The input is a whole-number fill followed by Tab, not incremental character typing. A known-identifier search does not prove exact-match semantics: the UI advertises partial names/numbers with wildcards. Wildcard syntax and filter inclusivity were not exercised.

Capture raw CLI stdout privately before printing anything. Snapshots, detail pages and vendor responses may contain contact names, email addresses or access material; never print whole snapshots, hidden inputs, all attributes, arbitrary network data or raw detail text. Filter stdout before display to allowed control labels, schema and counts. Preserve raw bytes independently of any decoded JSON. The CLI can wrap an object in a JSON string; decode that wrapper only when the first parse actually returns a string.

Use the following read-only expression through `agent-browser ... eval --stdin` with subprocess stdin. It was exercised for both known-ID observations; save its stdout with exclusive file creation and reject ordinary existing files and dangling/resolving symlinks before capture:

```javascript
(() => ({
  source: location.href,
  observedAt: new Date().toISOString(),
  headers: Array.from(document.querySelectorAll('thead th'), e => e.innerText),
  rows: Array.from(document.querySelectorAll('tbody tr'), tr => ({
    cells: Array.from(tr.querySelectorAll('td'), e => e.innerText),
    links: Array.from(tr.querySelectorAll('a'), e => ({text: e.innerText, href: e.getAttribute('href')})),
    buttons: Array.from(tr.querySelectorAll('button'), e => ({text: e.innerText, label: e.getAttribute('aria-label')}))
  })),
  inputs: Array.from(document.querySelectorAll('input:not([type=hidden])'))
    .filter(e => e.getBoundingClientRect().width > 0)
    .map(e => ({label: e.labels?.[0]?.innerText || e.getAttribute('aria-label'), type: e.type, value: e.value})),
  pagination: Array.from(document.querySelectorAll('button'))
    .filter(e => /page/i.test(e.getAttribute('aria-label') || ''))
    .map(e => ({label: e.getAttribute('aria-label'), disabled: e.disabled})),
  resultLabel: document.body.innerText.match(/\b\d+-\d+ of \d+\b/)?.[0],
  pageSize: document.querySelector('.mud-table-pagination-select')?.innerText,
  help: Array.from(document.querySelectorAll('p')).map(e => e.innerText)
    .filter(t => /wildcard|partial|search/i.test(t))
}))()
```

Validate the saved observation, not just the successful fill command:

- Source is the official solicitation-search URL; five table labels are Solicitation Number, Title, Status, Published, Closing Date. Do not substitute the neighboring contract search's seven-field schema.
- Search retains `275-CO`; one row has five original string fields.
- The observed row is `275-CO`, `FY 2027 Food Items for Bid - 2nd Quarter – Cheese`, `ACTIVE`, `10/28/2026 3:27:00 PM`, `11/12/2026 2:00:00 PM`.
- Displayed count is `1-1 of 1`, page size 25, and First/Previous/Next/Last page are all disabled.
- Date fields remain empty and the visible Status selector remains Active. This selector is not fully represented by the ordinary input capture; inspect the visible selector separately.
- Check for source warnings/challenges before accepting. Preserve date/time text exactly; the source timezone and edit/version timestamp were not established.

Do not use generic network-idle waits. Blazor controls can appear before interactive startup: if a whole-value fill is cleared during hydration, inspect current state and allow only one deliberate same-ID refill, then stop if it still fails. No such refill was needed in the two retained observations.

## Details and original-document boundary

The table row has no anchor or button, but clicking its number is functional:

```sh
agent-browser --config "$CONFIG" --session "$SESSION" find text '275-CO' click --exact
agent-browser --config "$CONFIG" --session "$SESSION" wait --text 'VIEW FULL SOLICITATION ON BIDNET'
agent-browser --config "$CONFIG" --session "$SESSION" snapshot -i
```

Wait for the detail state before interpreting the click. An immediate capture during navigation still showed the search view; it was not evidence that the click had no effect. The actual published route became <https://purchasingtransparency.traviscountytx.gov/public/search/solicitations/275-CO>. Its Solicitation Details view confirmed the number, title and ACTIVE status, and showed Published Date `10/28/2026` and Closing Date `11/12/2026`; keep these date-only display values distinct from search-row timestamps. Buyer contact information is present and must stay private.

The detail view exposed `VIEW FULL SOLICITATION ON BIDNET`, linking to <https://www.bidnetdirect.com/private/solicitations/9902787955/abstract>. Following this actual published link in the owned browser reached a page titled `BidNet Direct - SSO Login` with Username, Password, Login and Register controls at the vendor identity provider. No credentials were entered, registration attempted, or alternate route probed. Stop there. Do not infer that a registered account is free or sufficient, or that every solicitation has the same restriction.

No direct original attachment/download control was observed in the sampled county detail view. No original was downloaded, no PDF signature/page count/content/hash exists, and the 12 MiB original-document allowance was unused. This is metadata-only acquisition for this sample, not universal attachment absence. Browser Print to PDF is not a source original. Future authorized original acquisition requires an actually exposed free link and separate byte/content/identity/count/hash validation; if UI cannot prebound size, disclose that any size guard is post-download rather than transfer-enforced.

## Repeatability, integrity and recovery

Close only the owned session, then start a fresh uniquely suffixed owned session with the same reviewed configuration and no restored state. Repeat the known-ID search once, retain separate timestamped stdout and session/action provenance, and compare the original five cells, filters, count, page size and disabled navigation state. On 2026-11-05 the two observations at 20:04:22Z and 20:04:40Z matched. Both retained startup captures displayed seven default ACTIVE rows. An additional bounded known-ID visit inspected details; its startup readiness was checked but no third startup row-count capture was retained. Four deliberate page opens, three whole-ID searches and two row-detail clicks totaled nine deliberate source actions, below the twelve-action budget. Redirects and ordinary browser assets are not separate deliberate searches. All three owned browser sessions were explicitly closed.

Record SHA-256 of raw stdout only after successful exit, parse and schema/identity/count validation. For offline reuse, verify the retained hash first and revalidate those conditions from the same saved bytes without browser access. This zero-request hash/schema rerun was exercised. It proves local byte integrity, not source freshness. Keep the observation timestamp separate from source publication/closing dates and unknown revisions.

This supervised recipe has no automated archive promotion, source-wide lock, unattended retry loop, byte-range resume or persistent client database. Use one operator-owned writer per evidence directory and exclusive new capture names. An interrupted/failed capture is unvalidated evidence: retain it, do not overwrite/promote it or silently rehash altered bytes. Inspect it offline; a new live observation requires a new destination and remaining authorization/budget. Do not call this automatic crash recovery or resumable download. SQLite integrity, Bun typecheck, production TDD, CRAP, duplication and mutation metrics are not applicable because no client/code is introduced.

## Provenance and limits

Earlier repository inventory classified solicitation acquisition as unimplemented: interface inspection alone had not proved bounded retrieval, attachments or bulk access. That historical assessment is superseded only for this demonstrated metadata workflow. Earlier blanket browser-serialization restrictions were superseded by authorization for ordinary browser assets/SignalR/concurrency; no blocked API or attachment workflow is claimed repaired. Contract-search evidence remains distinct and cannot establish solicitation coverage.

Private evidence retains raw observations, timestamps, owned-session command outcomes, detail/vendor responses and hashes. A diagnostic allowlist accidentally included one public buyer email in tool stdout; that transcript is excluded from publication, and the reference contains no buyer identity/contact information. Do not claim all diagnostic output was privacy-clean.

Multi-page enumeration, wildcard/status/date criteria beyond the retained ACTIVE known-ID sample, inactive/awarded opportunities, full history, amendments/revisions, stable global uniqueness, attachments behind vendor access, document availability for other solicitations and links to awards/payments remain unverified. One reproducible record is not a complete procurement archive. Fresh independent review and parent inventory integration remain owner-controlled acceptance steps, not self-awarded passes.
