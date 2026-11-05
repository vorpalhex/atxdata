# Contract Search: Supervised Browser Access

Intent: acquire a bounded public contract-metadata observation using the normal interface, preserving provenance and original field text. This is not an API client, bulk archive, or original-contract-document downloader.

## Source and scope

Official legacy route: <https://ethicspolicy.traviscountytx.gov/public/search/contracts>.
Its observed redirect leads to <https://purchasingtransparency.traviscountytx.gov/public/search/contracts>, the Purchasing Office Transparency Portal's Contract Search. Follow the actual official destination, not a guessed API.

The browser uses Blazor/SignalR. Normal asset loading, polling and concurrent browser requests are allowed; API-client single-flight rules do not apply. Keep searches deliberate, honor site restrictions/cooldowns, avoid rapid retries, and download one original at a time if a public document is exposed. Do not submit procurement actions, register, purchase, bypass challenges, or replay private SignalR connection identifiers.

Use the general `agent-browser` skill and the installed CLI's version-matched core instructions. Chrome and a POSIX shell/Python 3 suffice for this supervised recipe. No hosted service, login, saved operator profile, Bun program or persistent client database is required. Raw records, buyer names, browser state and evidence must stay private outside source.

## Browser procedure

Execute commands through the agent's terminal tool. Resolve `EVIDENCE` to a fresh canonical absolute private directory outside the checkout, created with mode 0700 using the operator's approved scratch/output facility. Do not reuse an occupied observation directory or a symlink. Derive a unique task session with `agent-browser session id --scope worktree --prefix contracts`; use that literal session ID for every command, rather than the shared default.

Create an explicit reviewed empty JSON configuration in that directory with the agent's file-writing tool, then use these arguments consistently. `SESSION` is the resolved task session; `CONFIG` is the absolute configuration path. Start without `--restore`, `--auto-connect`, or an operator profile.

```sh
agent-browser --config "$CONFIG" --session "$SESSION" open 'https://purchasingtransparency.traviscountytx.gov/public/search/contracts'
agent-browser --config "$CONFIG" --session "$SESSION" snapshot -i
```

The normal initial page can render ten default rows. That is startup behavior, not an authorized broad crawl. Do not page through those records or enter broad supplier/wildcard terms merely to discover an identity. This verified sample uses the already known contract number `4400003110`; a different identity needs an explicitly bounded scope.

Use the current Search textbox ref for one whole-value fill, not character-by-character typing. The semantic locator below also works:

```sh
agent-browser --config "$CONFIG" --session "$SESSION" wait --fn "document.querySelectorAll('thead th').length===7 && document.querySelectorAll('tbody tr').length>0"
agent-browser --config "$CONFIG" --session "$SESSION" find label Search fill '4400003110'
agent-browser --config "$CONFIG" --session "$SESSION" press Tab
agent-browser --config "$CONFIG" --session "$SESSION" wait --fn "document.querySelector('tbody')?.innerText.includes('4400003110')"
```

Do not wait for generic network idle: SignalR may keep the browser busy indefinitely. A search input can be visible before interactive startup finishes. In one verified fresh session, an early fill was cleared by startup and the wait timed out. Inspect the actual input and results; if the input is empty after startup, permit one deliberate refill with the same whole number and repeat the result wait. Do not loop retries or treat a successful fill command as a successful search. If the input remains populated but no matching row appears, preserve the observation and stop rather than broadening the query.

Before saving, confirm all of the following in the rendered page:

- Search contains the requested number and no date filters were added.
- Table has exactly the seven labels Number, Name, End Date, Type, Status, Supplier Name, Buyer Name.
- Exactly one data row has Number text `4400003110`.
- UI label is `1-1 of 1`, page size is 10, and all four page-navigation buttons are disabled.
- No source error, login challenge or rate-limit warning is present.

Use a targeted DOM extraction, not a full HTML/forms/network dump. The following read-only expression returns the original row fields and visible scope for private capture through `agent-browser ... eval --stdin`:

```javascript
(() => ({
  source: location.href,
  observedAt: new Date().toISOString(),
  search: document.querySelector('input[type="text"]:not([readonly])')?.value,
  headers: Array.from(document.querySelectorAll('thead th'), e => e.innerText),
  rows: Array.from(document.querySelectorAll('tbody tr'), tr => ({
    cells: Array.from(tr.querySelectorAll('td'), e => e.innerText),
    links: Array.from(tr.querySelectorAll('a'), e => ({text: e.innerText, href: e.getAttribute('href')})),
    buttons: Array.from(tr.querySelectorAll('button'), e => ({text: e.innerText, label: e.getAttribute('aria-label')}))
  })),
  pagination: Array.from(document.querySelectorAll('button'))
    .filter(e => /page/i.test(e.getAttribute('aria-label') || ''))
    .map(e => ({label: e.getAttribute('aria-label'), disabled: e.disabled})),
  resultLabel: document.body.innerText.match(/\b\d+-\d+ of \d+\b/)?.[0]
}))()
```

Use the agent's file-writing/subprocess tools to save stdout privately with exclusive creation, never shell overwrite redirection. Reject an existing file or dangling/resolving symlink before invoking the capture command. Check the command exit and parse its output; some CLI captures wrap the object in a JSON string, so decode that string once more when necessary while preserving the raw original stdout bytes for hashing. Do not promote an error or partial as a validated observation. Verify all schema, identity, row-count and pagination conditions above against the saved bytes, then record their SHA-256. Keep the original number, dates and names as strings; the observation timestamp is not a source edit/version timestamp. A JSON evidence receipt here is not an unattended collector's persistence layer.

Close only the owned session:

```sh
agent-browser --config "$CONFIG" --session "$SESSION" close
```

Reopen a fresh owned session and repeat the same query once to verify repeatability without saved cookies. Preserve both timestamped observations separately; compare original cells, schema, result label and navigation state. Identical rows are evidence of repeatability for that identity, not source freshness or historical version coverage. For offline reuse, verify the saved hash and revalidate its schema/counts without reopening a browser. Interrupted/failed capture remains unvalidated; inspect retained output before choosing a new filename or a separately approved new observation.

## Documents and coverage limits

The sampled result contains no links or buttons. A normal click on its contract-number cell left the URL unchanged and exposed no detail route. No export/download control was observed in this Contract Search view. This establishes only that this sample exposes metadata, not an original attachment; it does not prove every contract lacks public documents. Do not print the browser page to PDF and label it an original contract, guess attachment endpoints, or substitute solicitation documents. Future document acquisition requires an actually exposed public source link and content/signature/identity verification.

The sample's complete-number input is not proven exact-match query semantics: the page advertises partial names/numbers and wildcards. `1-1 of 1` reconciles this one UI result only. Wildcard syntax, date-filter inclusivity, multi-page enumeration, global key uniqueness, revision history, complete procurement coverage and cross-links to payments/court approvals remain unverified.

## Verification and provenance

Local agent-browser 0.41.2 with managed Chrome reproduced the same seven-field row in two independently opened sessions. Both showed `1-1 of 1` and four disabled navigation buttons; row links/buttons were empty. The second session's early-fill timeout and successful same-number refill are retained in private evidence, not erased. Browser sessions were explicitly closed. No original contract file or standalone API payload was acquired or claimed.

An earlier reconnaissance query returned nine rows under a five-row worker cap; that historical overrun remains disclosed. The operator subsequently clarified that normal browser concurrency is not subject to the API serialization rule. This correction removes that transport blocker without retroactively changing the earlier record-cap incident.

This is a supervised metadata workflow. Production-client TDD, Bun/SQLite integrity, CRAP, duplication and mutation metrics are not applicable because no production client is introduced; real browser/result and private offline validation are still required. Raw record captures, personal buyer fields, browser session material and test evidence are excluded from publication. Independent review must assess the actual procedure and retained evidence before acceptance.
