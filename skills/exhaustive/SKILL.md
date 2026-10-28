---
name: exhaustive
description: Run finite, coverage-driven investigations by defining the complete search space, recording a plan or TODO ledger, processing every item in batches, delegating independent slices when authorized, and merging batch findings into a complete result. Use when checking every source file, every document, every record, every agenda item, or any bounded domain where missing one lead matters.
metadata: {"clawdbot":{"emoji":"🔎","requires":{"anyBins":["rg","find"]},"os":["linux","darwin","win32"]}}
---

# Exhaustive

Use this skill when the job is not "look around" but "cover the whole bounded domain." The core move is to define the complete search space, prove it is finite, track every item in a durable ledger, process items in explicit batches, and merge the evidence into a final answer with coverage, gaps, and residual risk.

## When to Use

- Auditing every source file for a behavior, feature, dependency, secret, or bug pattern
- Reviewing every PDF, document, agenda packet, transcript, or data file in a directory
- Checking every endpoint, route, migration, database table, config file, or generated artifact
- Comparing every item in a finite external list against local files or API results
- Investigating high-stakes questions where sampling would create unacceptable miss risk
- Splitting a large review across parallel agents, tools, or repeated work sessions
- Producing an evidence-backed final report with explicit coverage and known gaps

## Define the Search Space

Before opening files in detail, write down what counts as in scope and out of scope. The search space must be finite, enumerable, and reproducible.

```bash
# Source-code example: enumerate all tracked project files.
git ls-files > /tmp/all-files.txt
wc -l /tmp/all-files.txt
# 842 /tmp/all-files.txt

# Directory example: enumerate PDFs recursively.
find ./agendas -type f -iname '*.pdf' | sort > /tmp/all-pdfs.txt
wc -l /tmp/all-pdfs.txt
# 37 /tmp/all-pdfs.txt

# Mixed file example: enumerate documents and data files.
find ./records -type f \( -iname '*.pdf' -o -iname '*.docx' -o -iname '*.csv' \) | sort > /tmp/all-records.txt
# Produces a deterministic manifest of files to process.
```

Record the definition in a plan file near the work, unless the user asked not to write files.

```markdown
# Exhaustive Review Plan

## Question
Find every place this application sends outbound email.

## Search Space
- Universe: all tracked source files in this repository from `git ls-files`.
- Exclusions: generated lockfiles, vendored assets, binary images.
- Manifest: `analysis/exhaustive-manifest.txt`.
- Total items: 842 files.

## Completion Rule
The review is complete only when every manifest item is marked `done`, `excluded`, or `blocked` with a reason.
```

If the search space cannot be made finite, stop and narrow it.

```markdown
## Not Yet Exhaustive

The request "check the internet for every mention of the project" is not finite.
To make it exhaustive, choose a finite domain:
- specific websites and URL lists
- a search-results depth and query set
- a local export of pages
- a bounded date range and archive
```

## Build the Ledger

Use a durable ledger that survives interruptions. Keep the ledger boring and mechanical: item, batch, status, assignee, evidence, findings.

```markdown
# TODO

## Scope
- Domain: all PDFs in `./agendas`
- Manifest generated: 2026-05-13
- Completion rule: every PDF has a status and summary

## Batches
- [ ] Batch 001: agenda PDFs 001-010
- [ ] Batch 002: agenda PDFs 011-020
- [ ] Batch 003: agenda PDFs 021-030
- [ ] Batch 004: agenda PDFs 031-037

## Findings Index
| Finding ID | Batch | Item | Severity | Summary |
| --- | --- | --- | --- | --- |
```

For source files, generate a manifest and slice it into stable batches.

```bash
mkdir -p analysis/exhaustive
git ls-files \
  | rg -v '(^package-lock\.json$|^pnpm-lock\.yaml$|^dist/|^vendor/)' \
  > analysis/exhaustive/manifest.txt

split -l 50 -d -a 3 analysis/exhaustive/manifest.txt analysis/exhaustive/batch-
ls analysis/exhaustive/batch-*
# analysis/exhaustive/batch-000
# analysis/exhaustive/batch-001
# ...
```

For documents, build a manifest that preserves absolute or repo-relative paths and any metadata needed for citation.

```bash
find ./city-council -type f -iname '*.pdf' | sort > analysis/exhaustive/pdf-manifest.txt
nl -ba analysis/exhaustive/pdf-manifest.txt > analysis/exhaustive/pdf-ledger.tsv
# Numbered manifest makes "PDF 17" unambiguous across agents and reports.
```

Use statuses consistently.

```markdown
Status values:
- `pending`: not yet started
- `in_progress`: currently assigned
- `done`: reviewed and summarized
- `excluded`: intentionally skipped with reason
- `blocked`: cannot process with current tools or access
- `needs_followup`: reviewed, but a specific unresolved lead remains
```

## Run a Recon Pass

Do a fast pass over the entire manifest before deep work. Recon helps choose batches, identify generated files, and find obvious hotspots without claiming completion.

```bash
# Codebase recon: names and likely features.
rg -n "sendEmail|mailer|smtp|postmark|ses|resend|mailgun|nodemailer" .
# Produces candidate files, but does not replace manifest review.

# Count file types.
sed 's/.*\.//' analysis/exhaustive/manifest.txt | sort | uniq -c | sort -nr
# Helps assign batches by language or format.

# PDF recon: filenames and rough agenda categories.
find ./agendas -type f -iname '*.pdf' -maxdepth 3 | sort
# Identifies date ranges and special meetings before extraction.
```

Write recon results separately from final findings.

```markdown
## Recon Notes
- `src/email/` contains explicit mailer abstractions.
- `apps/api/routes/invite.ts` references `sendInviteEmail`.
- Several tests use mocked email clients.
- Recon found likely leads, but all source files remain in scope.
```

## Process Batches

Each batch should be small enough to finish cleanly and large enough to avoid overhead. For code, 20-80 files is typical. For long PDFs, 1-5 documents may be enough.

```markdown
## Batch 003 Work Note

Items:
- `src/auth/invite.ts`
- `src/billing/invoice.ts`
- `src/lib/email.ts`

Question:
Find outbound email behavior, including direct sends, queued sends, provider calls, and templates.

Required output per item:
- status
- evidence with file path and line
- finding summary or "no relevant behavior"
```

For local code review, inspect every file in the batch, not just search hits.

```bash
sed -n '1,220p' src/lib/email.ts
sed -n '1,220p' src/auth/invite.ts
sed -n '1,220p' src/billing/invoice.ts
# Read complete small files; for large files, read all relevant chunks and note line ranges covered.
```

For PDFs or documents, extract text and keep page references when possible.

```bash
pdftotext -layout agendas/2026-05-18-council-agenda.pdf /tmp/agenda.txt
rg -n "public hearing|ordinance|contract|budget|zoning" /tmp/agenda.txt
# Extracts reviewable text; use page-aware tools if citations need page numbers.
```

Update the ledger immediately after each batch.

```markdown
## Batch 003 Result

Status: done
Items reviewed: 3 / 3

| Item | Status | Evidence | Summary |
| --- | --- | --- | --- |
| `src/auth/invite.ts` | done | line 42 `sendInviteEmail` | Sends invite email through shared mailer |
| `src/billing/invoice.ts` | done | no outbound provider calls | No email send; invoice events only |
| `src/lib/email.ts` | done | lines 12-88 | Shared Resend client wrapper |
```

## Use Delegation Safely

Use subagents only when the active environment and user instructions allow delegation. Delegate independent batches with disjoint read or write scopes, and keep the ledger as the coordination contract.

```markdown
Agent task template:

You are processing Batch 004 of an exhaustive review.

Goal:
Find every outbound email behavior in the assigned files.

Scope:
Only inspect these manifest items:
- `src/jobs/reminders.ts`
- `src/jobs/reports.ts`
- `src/notifications/digest.ts`

Do not inspect or summarize other batches.

Required output:
- Mark each item `done`, `excluded`, or `blocked`.
- For each relevant finding, include file path, line number, and one-sentence summary.
- For each no-hit item, explicitly say "no relevant outbound email behavior found."
- List unresolved questions separately.
```

When running parallel agents, assign non-overlapping batches and ask for structured outputs that merge cleanly.

```markdown
Batch report format:

## Batch ID
Batch 004

## Coverage
- Assigned items: 3
- Done: 3
- Blocked: 0

## Findings
| Finding ID | Item | Evidence | Summary |
| --- | --- | --- | --- |

## No-Hit Items
- `src/jobs/reports.ts`: no relevant outbound email behavior found

## Follow-Ups
- None
```

Do not let agents redefine scope. If an agent finds a lead outside its batch, record it as a cross-batch lead instead of silently expanding its assignment.

```markdown
## Cross-Batch Leads
- Batch 004 found `src/lib/email.ts` imported by `src/jobs/reminders.ts`; `src/lib/email.ts` belongs to Batch 001 and must be checked against Batch 001's result.
```

## Merge Results

Merge only after all batches are complete or explicitly blocked. The merge pass reconciles duplicate findings, checks cross-batch leads, and proves coverage from the ledger.

```bash
rg -n "Status: (pending|in_progress)" analysis/exhaustive
# No output means no unfinished batch status remains.

rg -n "blocked|needs_followup" analysis/exhaustive
# Review unresolved items before finalizing.

wc -l analysis/exhaustive/manifest.txt
# 842 analysis/exhaustive/manifest.txt
```

Use a final merge table.

```markdown
# Exhaustive Review Result

## Coverage
- Search space: all tracked source files excluding generated/vendor outputs
- Manifest total: 842
- Reviewed: 836
- Excluded: 6 generated files
- Blocked: 0

## Findings
| ID | Evidence | Summary | Confidence |
| --- | --- | --- | --- |
| EMAIL-001 | `src/lib/email.ts:12` | Shared Resend client wrapper | high |
| EMAIL-002 | `src/auth/invite.ts:42` | Sends invite emails | high |

## No-Hit Summary
All other reviewed files had no outbound email behavior under the defined criteria.

## Residual Risk
Dynamic provider calls generated at runtime were not present in reviewed source files.
```

Deduplicate findings by behavior, not only by text match.

```markdown
Duplicate pattern:
- `src/auth/invite.ts` calls `sendInviteEmail`
- `src/lib/email.ts` implements `sendInviteEmail`

Merged finding:
- Invitation flow sends email through shared mailer; cite both call site and implementation.
```

## Validate Coverage

Before finalizing, run checks that compare the manifest to completed batch outputs. Use the simplest reliable method available.

```bash
# Check that every manifest item appears somewhere in batch results.
while IFS= read -r item; do
  rg -F -- "$item" analysis/exhaustive/results >/dev/null || printf 'missing: %s\n' "$item"
done < analysis/exhaustive/manifest.txt
# No output means every manifest item is mentioned in results.
```

For file reviews, run one last targeted search to catch obvious missed leads, then map each hit to an existing finding or a reviewed no-hit item.

```bash
rg -n "smtp|email|mail|send|notify|resend|ses|postmark|mailgun|nodemailer" .
# Every hit should be accounted for in findings, no-hit notes, or exclusions.
```

For document reviews, sample the extraction quality and record blocked files clearly.

```bash
find ./agendas -type f -iname '*.pdf' | sort > /tmp/pdfs.txt
while IFS= read -r pdf; do
  pdftotext "$pdf" - | head -n 5 >/dev/null || printf 'blocked extraction: %s\n' "$pdf"
done < /tmp/pdfs.txt
# Any blocked extraction must appear in the final residual risk.
```

## Report Results

The final answer should separate coverage from conclusions. Lead with the answer, then show enough evidence to make completeness credible.

```markdown
## Answer
I found 4 outbound email behaviors.

## Coverage
Reviewed all 842 manifest items:
- 836 source files reviewed
- 6 generated files excluded by rule
- 0 blocked

## Findings
1. Invitation email
   Evidence: `src/auth/invite.ts:42`, `src/lib/email.ts:12`
   Behavior: sends invite through Resend.

2. Billing receipt email
   Evidence: `src/billing/receipt.ts:77`
   Behavior: queues receipt email after payment success.

## Residual Risk
No runtime-only configuration source was found, but environment-controlled provider selection could change the actual provider.
```

For agenda or document analysis, include an itemized appendix when useful.

```markdown
## Agenda Review
Reviewed 37 PDFs covering meetings from 2026-04-01 through 2026-05-20.

## Items Requiring Attention
| Date | Document | Page/Section | Issue |
| --- | --- | --- | --- |
| 2026-05-18 | council agenda | item 8B | zoning hearing with public comment |

## Appendix
- PDF 001: no relevant items
- PDF 002: item 4C contract amendment
- PDF 003: blocked OCR; scanned image only
```

## Anti-Patterns

Do not call a review exhaustive if the search space was not defined.

```markdown
Bad:
"I searched for email and found two results."

Good:
"I reviewed all 842 manifest items. Keyword search found two likely results, and full batch review found no additional email behavior."
```

Do not let a growing lead list replace the manifest.

```markdown
Bad:
- Search for "email"
- Follow imports
- Stop when no more leads seem interesting

Good:
- Enumerate all files
- Search for "email" for recon
- Review every file batch
- Reconcile search hits against final findings
```

Do not hide blocked items.

```markdown
Bad:
"Reviewed the agenda packet."

Good:
"Reviewed 36 of 37 PDFs. One scanned PDF could not be extracted with available tools and is listed as blocked."
```

## Tips

- Exhaustive means "complete over a defined finite space," not "infinite effort."
- Create the manifest before deep inspection; otherwise early findings will bias what gets counted as in scope.
- Keep the ledger in a file for long jobs so progress survives context compaction, interruptions, and agent handoffs.
- Use recon to improve batching, not to replace batch-by-batch review.
- Batch boundaries should be stable: line-numbered manifests, sorted file lists, or explicit ID ranges are easier to merge.
- Require no-hit reporting. An item with no finding still needs evidence that it was checked.
- Cross-batch leads should be logged and reconciled during merge instead of expanding an agent's scope ad hoc.
- Separate excluded from blocked: excluded means intentionally out of scope; blocked means intended but not completed.
- Final reports should include coverage numbers, exclusion rules, blocked items, findings, and residual risk.
- If the user asks for "every" or "literally all," clarify or define the finite domain before claiming completion.
