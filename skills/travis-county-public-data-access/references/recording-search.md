# Recording and Land Records: Supervised Live Browser

Intent: search the official recording index and obtain one complete free, unofficial instrument image set through the normal live interface. This is a browser-control skill, not a reconstructed HTTP client, bulk scraper or certified-copy service.

## Sources and verification status

Start with the [County Clerk Recording Search + Copies page](https://countyclerk.traviscountytx.gov/departments/recording/search-copies-of-records/), then follow its actual [TCCSearch](https://www.tccsearch.org/) link. Its observed Real Estate search page is <https://www.tccsearch.org/RealEstate/SearchEntry.aspx>.

The operator confirmed the manual Brave workflow worked entirely: disclaimer, Real Estate search, date/type selection and the subsequent viewing flow described to them. This is operator-reported live success, not an agent-retained instrument/download receipt. Exact instrument identity, page count, original image bytes and hashes were not supplied and must not be invented. Agent-controlled live image acquisition remains to be verified.

A separate fresh managed-Chrome attempt displayed an explicit Cloudflare block before the search form. Genuine Firefox initialized the cached form and produced a cancelled native submission in an earlier offline experiment. Those are distinct observations: neither the blocked headless session nor offline replay overrides the operator's live Brave success, and the offline payload is not authorization to replay old viewstate or cookies.

The clerk advertises free self-printed online copies with an unofficial-copy watermark. Clerk-produced email/paper/certified copies are separate services and may require payment. Recording indexes are described as “Most,” and redacted images as “Mid 1980’s to present”; these are published availability claims, not verified completeness. Redaction does not imply that parties, addresses or signatures are absent.

## Choose and attach to the live browser

Load the general `agent-browser` skill and run `agent-browser skills get core` through the terminal tool for version-matched instructions. Use a task-specific named session, never the shared default session. Keep raw records, browser state and download evidence in an approved private output directory outside source.

Prefer controlling the already working, operator-authorized Brave tab rather than silently launching a fresh headless browser that may be blocked. Agent-browser requires an approved CDP endpoint to attach; an ordinary Brave window is not automatically controllable merely because the application is running.

- If the operator already exposes an authorized local debugging endpoint, connect to that exact endpoint. Do not guess a remote endpoint or expose debugging on a public interface.
- Do not quit/relaunch Brave, add remote-debugging flags, alter its profile, enable JavaScript automation, install an extension, copy browser databases/cookies, or attach unrelated personal tabs implicitly. If attachment is not available, ask for the smallest approved setup or use operator-assisted search instead.
- For a shared attached browser, list tabs and select only the TCCSearch target. Use the stable tab target ID and pin the session so a closed tab cannot silently redirect automation to another tab. A tab list can expose unrelated titles; keep it private and report only the authorized target.
- Use desktop/native control for browser chrome or dialogs when needed, following the installed computer-use instructions and operator approval. Do not use it to evade a browser security gate or fabricate DOM state.

With `SESSION`, `CDP_ENDPOINT` and `TARGET_ID` resolved from the authorized browser rather than guessed, these are the attachment commands through the terminal tool:

```sh
agent-browser --session "$SESSION" --cdp "$CDP_ENDPOINT" --pin-tab tab list --json
agent-browser --session "$SESSION" tab "$TARGET_ID"
agent-browser --session "$SESSION" snapshot -i
```

Pinning and target selection must be checked against the actual returned URL. On a first attachment with no prior binding, `--pin-tab` can open a fresh task-owned tab rather than adopt the operator's active tab; obtain approval for that incidental tab and identify it separately for cleanup. Do not close or repurpose the operator's existing tab. Stop if the selected target is not the intended TCCSearch page. Do not log token-bearing remote CDP URLs. No cloud-provider, proxy or identity change is implied by this skill.

## Run one bounded search

Browser-managed subresources, normal concurrent requests, WebSockets and session traffic are ordinary browser operation, not an API-client serialization violation. Keep searches deliberate, downloads one at a time, and honor visible rate limits and site restrictions. No unbounded backfill, broad name harvesting, rapid retries or API reverse engineering.

1. Inspect the live page. If it is a public-use disclaimer, let the operator review it or accept only the ordinary public disclaimer within the approved browsing scope. If the page is already in results/viewing state, preserve that context; do not reset it merely to repeat startup.
2. Choose the actual Real Estate → Search navigation if a fresh search is needed. Do not substitute civil records or a commercial mirror.
3. For the demonstrated bounded example, leave party names/instrument numbers blank. Set Date Filed From and Date Filed To to October 30, 2026 using the actual date controls. Select REL — RELEASE.
4. Use fresh snapshot refs for each meaningful UI change. A typical interaction uses `click`, `fill`, `select` or `check`; exact labels/refs depend on the current page. For masked date editors, focus the real input and use native keyboard entry or the calendar, then tab out. Read the resulting visible dates back before submitting. Do not inject authored clientState, call private application methods or construct ASP.NET form bodies.
5. Click the visible Search button, not Login. Wait for the actual result grid, visible message or URL change—not generic network idle. Confirm dates/type persisted and record the displayed count/page size, sort and continuation controls privately.
6. If the search returns too many results for the approved scope, do not traverse the list. Ask to narrow the date/type scope or agree a bounded metadata page. A zero-result message means this query returned no results, not that no instrument was recorded.

Typical ref-driven commands, using refs from the CURRENT snapshot rather than these placeholders:

```sh
agent-browser --session "$SESSION" snapshot -i
agent-browser --session "$SESSION" click "$DATE_CONTROL_REF"
agent-browser --session "$SESSION" keyboard type '10302026'
agent-browser --session "$SESSION" press Tab
agent-browser --session "$SESSION" snapshot -i
```

These illustrate native interaction only; inspect the actual widget's existing value and selection first. Do not append digits to a populated date, assume the same mask in every browser, or call the example a tested end-to-end script. The operator's successful manual procedure is the current live evidence.

## Inspect and save one instrument

1. Open one actual returned instrument using its visible link/image control. Preserve the source's instrument number, filed date, type, displayed page count, URL and observation time privately; retain identifiers as strings. Party names and addresses are private evidence, not public documentation examples.
2. Use the actual free document/image-viewing or unofficial-copy control. Do not choose certified copies, shopping-cart/paid services, submit a records request, create an account or enter credentials without separate authorization. An optional Login link alone is not proof anonymous searching requires an account.
3. Confirm whether the viewer shows all pages or only one. Acquire the complete page set for this ONE instrument within an approved byte/page bound. Check page numbering and ensure no missing/duplicate pages. Respect any watermark/redaction; do not remove it.
4. Prefer a genuine source-provided download when exposed. Browser printing of the actual document-image viewer may be a legitimate unofficial self-printed copy, but label it as browser-generated and preserve its source/viewer provenance. Printing the search results is NOT acquisition of an instrument. Do not claim a browser-generated PDF is the source's original PDF bytes.
5. Set the private download destination before starting an owned browser, or verify the attached user's actual Downloads destination without changing their shared preferences. Do not overwrite existing files; compare directory state before/after and inspect the resulting file rather than trusting a “download started” message. Do not move/delete an operator's file without approval.
6. Check actual file signatures, hash, page count, first/last pages and instrument/date/type identity. Render image-only/scanned pages if text extraction is empty or garbled. The acceptance evidence must tie the saved pages to the selected instrument; a rendered page screenshot alone is not proof of a complete instrument.

Retain a private observation receipt: source URLs, timestamp, query scope, displayed counts/navigation, instrument identity, copy status, acquisition method, actual filenames/sizes/hashes and verified page count. Raw screenshots, records, headers, cookies and session data stay outside Git. Offline reuse verifies retained hashes and page identity; it does not re-query the portal or prove remote freshness. A supervised receipt is not an unattended client's persistence database.

## Failures, handoff and cleanup

- On Cloudflare or another challenge, stop agent actions. Request operator assistance or a site-approved access path; do not change providers, spoof identity or replay a working browser's credentials to route around denial. An operator independently using the normal public browser is distinct from an automated challenge bypass.
- If dates do not persist or Search returns validation errors, inspect actual controls and visible messages. Do not remove hidden login controls or manufacture a form payload. No more than one corrected, same-scope retry without inspecting the first outcome.
- If a download is partial, missing or ambiguous, preserve the evidence and do not label it validated or complete. Reconcile against the viewer before any separately approved retry. No automatic bulk/byte-range recovery is implemented.
- Release only the automation attachment/session created for this task. Do not close the user's Brave window or TCCSearch tab, clear their cookies, log them out, or stop a shared browser. `agent-browser close` on an externally attached browser detaches automation rather than granting ownership of the browser; confirm the installed version's behavior and preserve the user tab. Never use `close --all`.

## Acceptance and limits

This workflow is selected in preference to building a script because the ordinary operator browser works and live widget/session behavior should remain browser-managed. No production client, Bun program, SQLite store or reconstructed POST protocol is added; production TDD/CRAP/duplication/mutation metrics are N/A, not measured passes.

The remaining verification is a live agent-controlled or explicitly operator-assisted search tied to one complete saved free instrument with actual content/page/hash checks, plus fresh independent review of this skill. Operator-reported success, historical interface captures and offline Firefox replay must remain labeled separately. No bulk/date completeness, universal anonymous access, certified-copy status, or original-image acquisition is claimed merely by publishing this procedure.
