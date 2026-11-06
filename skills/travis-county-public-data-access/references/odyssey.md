# Odyssey public case records: observed search challenge

Browser prerequisite: agent-browser is an optional external CLI, not a private skill supplied by this repository. Follow [installation, private-session setup and the smoke test](browser-setup.md) before using its commands. Install with `brew install agent-browser` on macOS or `npm install -g agent-browser`, then run `agent-browser install` and `agent-browser skills get core` through the terminal tool. An ordinary human browser or another approved control tool can perform equivalent UI steps; preserve this procedure's scope and stopping rules.

## Status and official source

On 2026-11-05, the District Clerk's [Case Information & Records page](https://www.traviscountytx.gov/district-clerk/case-information-records) linked its “Online Court Records Search Portal” to [Travis County Odyssey Portal](https://odysseyweb.traviscountytx.gov/Portal/). The portal rendered anonymously, and its normal **Smart Search** link opened the search form. That form visibly contained an unchecked reCAPTCHA “I'm not a robot” checkbox. Observation stopped there without interacting with the challenge or submitting a query.

This is verified official-link discovery and search-interface inspection, NOT a working case-metadata/document acquisition skill or collector. No public case result, case detail, or original document was obtained. Access is **hard at the observed automated-search boundary** because of the visible challenge; this does not establish universal browser denial, mandatory registration, or a document paywall.

The current Clerk page describes:

- Free online search for digital copies.
- Family/Civil: 2006 to the present.
- Criminal: 2008 to the present.
- Official, certified and authenticated physical copies requested separately from the office.

These are publisher-described coverage/service distinctions, not tested historical availability or guarantees that every document is digital, public, free to download, or present. Odyssey individual records are distinct from Criminal/Civil Insights aggregate datasets and official OCA reports.

## Exact bounded observation

Environment: agent-browser 0.41.2, local managed Chrome; headed, fresh named session, explicit private configuration, fresh private download directory outside the checkout. No operator profile, restored cookies, paid hosted provider, login, identity disclosure, or payment was used.

The exercised action sequence was:

1. Run `agent-browser --version`, `agent-browser skills get core`, and `agent-browser session id --scope worktree --prefix tc-odyssey-final`.
2. Use the resulting literal session name and explicit `--config` on browser commands. Open the official Clerk page. Read only the official Odyssey link and the coverage/free-copy statements through targeted DOM evaluation.
3. Open the exact portal URL returned by that official link. Save `snapshot -i --json` privately; print only allowlisted control roles/names, never the whole snapshot.
4. The portal exposed “Smart Search Search for court records.” as `@e6` in that snapshot. Click that current ref. Its published destination was `https://odysseyweb.traviscountytx.gov/Portal/Home/Dashboard/29`; do not synthesize other dashboard or record IDs.
5. An immediate post-click snapshot had no controls. Wait with `wait --load domcontentloaded`, then take a fresh private `snapshot -i --json`. It showed the required record-number/name textbox, Clear, Submit, Advanced Filtering Options, and an “I'm not a robot” checkbox. A private screenshot independently confirmed the visible reCAPTCHA. No generic network-idle wait was used.
6. Stop without filling, submitting, clicking the CAPTCHA, or expanding the search. Close only the owned session with `close`; the close command returned success.

The first private configuration attempt failed locally because numeric `idleTimeout` was rejected: the CLI expected a string. No public page opened in that attempt. After `doctor --offline --quick`, changing that private value to `"30m"` allowed navigation. This local configuration failure is not source denial. The diagnostic found an unrelated default-session version warning; no unrelated browser was closed or repaired.

Counts: three deliberate public page navigations (Clerk, portal, Smart Search); zero submitted searches, zero result rows, zero case details, zero originals. Normal browser-managed assets and concurrent subresources were allowed. No direct endpoint probes, alternate routes, retries of challenged requests, broad name searches, or backfill were attempted.

Refs are observation-specific, not permanent selectors. Refresh refs after navigation or dynamic changes. Command output and raw screenshots remain private because browser output can contain access state and court-record data.

## Permitted supervised route and stopping rule

A human may use the ordinary officially linked portal in their own browser under its [Access Agreement](https://www.traviscountytx.gov/images/odyssey/Access-Agreement.pdf). The portal also publishes a [User Guide](https://www.traviscountytx.gov/images/odyssey/User-Guide.pdf) and [attorney FAQ](https://www.traviscountytx.gov/images/odyssey/FAQ-Attorneys.pdf). Those exact links were observed on the portal, but their PDF bodies were not fetched or validated here. Do not infer anonymous search rights, download terms, or supported pagination from their filenames.

This run was instructed to stop at a visible challenge. It did so; it did not test whether submission without solving the CAPTCHA is rejected. No challenge solver, stealth/plugin changes, user-agent spoofing, cookie/profile copying, alternate origin, or export bypass is authorized. There is no operator-confirmed successful Odyssey workflow in this evidence; success on another county portal is not proof for Odyssey. Human browser access remains a permitted route, not a claimed exercised acquisition result.

The smallest next decision is whether to authorize a separately supervised human visit. If authorized later, first select one real public, nonsealed case number from official published metadata, preferably involving an institutional civil party. Do not guess identifiers or use an unbounded blank/person search to discover them. Keep the future observation bounded to one result page of at most 20 cases, one case detail, and at most one free original document of at most 12 MiB. If no responsibly bounded query exists, stop for scope rather than fishing. These limits were not exercised downstream in this run.

At a later permitted document step, distinguish metadata from original access. Inspect actual available controls and fee terms; stop for login, payment, export denial or challenge rather than trying another route. Browser Print-to-PDF is not the original. A UI download without an advertised size may permit only a post-download size check: never describe the 12 MiB bound as pretransfer-enforced in that situation. Preserve the exact published source association privately before a single deliberate download.

## Integrity, privacy, and unsupported scope

Private evidence retains raw CLI responses, the search screenshot, a receipt and per-artifact SHA-256 hashes. Checksums establish retained evidence integrity, not acquired-record validity. There is no original-document hash, PDF signature/page/content validation, source-record schema, or result/pagination reconciliation because no case was acquired. The evidence receipt must not be published: it contains machine-local locations and browser observation material.

No original exists for an offline document-reuse or recovery test. Rehashing retained interface captures is local evidence reuse only, not a fresh source check, repeatable search, recovered download, byte-range continuation, or resume/idempotency proof. If a future original is obtained, validate its nonzero bounded size, signature, parser/content identity, page count and SHA-256 before archival credit; retain failures without overwriting evidence. Do not automatically retry an interrupted download or claim a reusable client checkpoint.

Party names, contact information, birthdates, addresses, minor information, allegations, access tokens and raw case snapshots must remain private even when publicly viewable. No case identifiers or personal case fields were collected or published here. Source files, browser configuration, downloads, cookies and raw evidence belong outside source control. Only this reference is the publishable deliverable.

Unverified: anonymous result submission, result schema, count and pagination limits, public/nonsealed case detail, document availability/fees, original-file retrieval, historical start dates in practice, full case history, amendments/versions, sealed/restricted handling, freshness, repeatability across fresh sessions, and complete archival coverage. No unattended collector, SQLite state, API route, acquisition guarantee or universal access conclusion is supplied.

## Acceptance gates

| Original card gate | Honest disposition |
| --- | --- |
| Initial Implementation | **BLOCK**: useful official-link/challenge reference delivered; working metadata/document acquisition not established. |
| Testing implementation e2e | **BLOCK**: exact search interface reached; zero records/originals. Landing/search rendering is not acquisition e2e. |
| ub-mode and code quality | **PASS (documentation scope only)**: smallest evidence-backed reference, no client/code added. TDD, CRAP, dryer, mutation, typecheck and SQLite/restart tests **N/A**, not passing code checks. |
| Sanitize | **PASS (named reference only)**: path/name/credential-pattern scan and manual review; the official `/Home/Dashboard/29` URL route is not a local filesystem path. All private raw evidence excluded. No repository-wide/history/index clearance claimed. |
| Fresh independent review | **BLOCK / pending chief-owned review**; implementation worker cannot self-pass it. |
| docs/skill passes | **BLOCK (original acquisition scope)**: bounded blocker documentation only; no working acquisition recipe, source inventory/main-skill integration, or broader completion claimed. Chief owns integration and final gate. |

Earlier source reconnaissance described the official free-viewing service and date ranges but was not current acquisition proof. Prior policy objections to ordinary browser asset concurrency are superseded, not retained as blockers. The concrete current stopping point is the observed Smart Search CAPTCHA; independent limitations above remain unresolved.
