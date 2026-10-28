---
name: pdf-to-text
description: Convert PDFs to searchable text with page boundaries.
version: 0.1.0
---

# PDF to Text

Use the public npm package `@opendocsg/pdf2md` to extract Markdown locally, without a paid API. Preserve the original PDFs as citation evidence. Markdown is a search aid, not a faithful rendering: tables, headers, footers, reading order, and printed page labels may be changed or removed.

## When to Use

- Convert text-layer PDFs or a directory of downloaded meeting documents into searchable Markdown.
- Preserve physical page boundaries for later source verification.
- Do not use this as OCR for scanned/image-only pages; escalate only the pages that need it.

## Prerequisites

Use the `terminal` tool to check `node --version` and `npm --version`. Use a current supported Node.js LTS release; the package depends on PDF.js through `unpdf`. Network access is needed for the initial npm download, not for sending PDF content to a service.

Pin `@opendocsg/pdf2md@0.3.5`, the version checked on 2026-10-27. A package pin does not freeze transitive dependencies; record Node and package versions, and retain a lockfile for a repeatable production pipeline. Do not patch the npm cache or rely on a workstation's private fix.

Keep source PDFs, conversions, logs, and tool installations in the chosen local data workspace (for this project, normally the sibling `atxdata-local` checkout), not in this code repository or directly in the home directory. Never rename or overwrite source documents to accommodate the converter.

## Directory Conversion: CLI Workaround

Run shell examples through `terminal`, from the code repository root. Replace the example directories with the actual input and a fresh output directory. Enumerate the PDFs first using `search_files` or Python, including relative paths and expected output names.

```sh
INPUT=$(node -p 'require("node:path").resolve(process.argv[1])' ../atxdata-local/pdf-input)
OUTPUT=$(node -p 'require("node:path").resolve(process.argv[1])' ../atxdata-local/pdf-markdown)
mkdir -p "$OUTPUT"
npx --yes @opendocsg/pdf2md@0.3.5 \
  --inputFolderPath="$INPUT" --outputFolderPath="$OUTPUT" --recursive
```

Omit `--recursive` for only the immediate directory. Always quote paths. Preflight the naming restrictions below; for unrestricted filenames use the library method instead.

### Current Upstream Naming Bug

As of 0.3.5, both the public package and upstream still derive output names with `x.split(folderPath)[1]`, followed by slicing at the first lowercase `.pdf`. This is not safe path handling.

- Never pass `--inputFolderPath=.` or `./`: periods in filenames can be interpreted as the directory separator token. For example, `./Budget.Report.pdf` with input `.` becomes `Budge.md`.
- Work around the dot-directory bug with a resolved absolute input path, as above. Ensure that full input-path string does not recur inside any relative source path.
- The CLI accepts `.PDF` and mixed-case extensions but strips only lowercase `.pdf`; `Budget.PDF` becomes `Budget.PD.md`.
- A name containing an earlier `.pdf`, such as `report.pdf.backup.pdf`, is truncated at that earlier occurrence. The same issue can affect directory components containing `.pdf`.
- For the CLI, require exactly lowercase `.pdf` at the end and no earlier `.pdf` anywhere in the relative path. Otherwise use the library method below; do not rename originals or repair outputs by guessing.
- Check for output-name collisions before converting, including `report.pdf` and `report.PDF` mapping to the same intended Markdown name. Resolve these explicitly in a source-to-output manifest rather than overwriting.

Source: [upstream CLI naming logic](https://github.com/opengovsg/pdf2md/blob/70535c6a8c4753e3dfd9393efee8c3c6d3ddbc07/lib/pdf2md-cli.js#L29-L33). The [older filename fix](https://github.com/opengovsg/pdf2md/pull/48) did not resolve these cases.

## Arbitrary Filenames: Public Library Workaround

Bypass the CLI's naming logic without modifying the public package. Install into the selected local data workspace, then run this single-file conversion through `terminal`. Repeat sequentially over an explicit manifest for a batch, preserving relative directories and replacing only the final extension. Do not flatten nested source paths.

```sh
TOOLS=../atxdata-local/pdf2md-tools
npm install --prefix "$TOOLS" --save-exact --no-audit --no-fund @opendocsg/pdf2md@0.3.5
node - "$TOOLS" ../atxdata-local/pdf-input/Budget.PDF ../atxdata-local/pdf-markdown/Budget.md <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [tools, input, output] = process.argv.slice(2);
const pdf2md = require(path.resolve(tools, 'node_modules/@opendocsg/pdf2md'));
(async () => {
  if (!/\.pdf$/i.test(input)) throw new Error('Expected a PDF input');
  if (path.resolve(input) === path.resolve(output)) throw new Error('Output must differ from input');
  const text = await pdf2md(new Uint8Array(fs.readFileSync(input)));
  if (!text.trim()) throw new Error('Empty extraction; inspect for scanned pages');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, text, { encoding: 'utf8', flag: 'wx' });
  console.log(`Wrote ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
```

Choose each output explicitly: derive it with a final-extension replacement (`relativePath.replace(/\.pdf$/i, '.md')`), check collisions, and refuse existing outputs. The library returns Markdown; the caller controls the filename. Keep the generated tool-install lockfile with local run metadata, outside this code repository.

## Page Boundaries and Extraction Quality

The library inserts `<!-- PAGE_BREAK -->` between physical PDF pages. Keep these markers intact. Physical page 1 is the segment before the first marker; each marker advances one page. These are not necessarily the document's printed page numbers. If adding numbered page markers, record that they are generated physical-page indices, not text from the PDF.

Do not promise preservation of non-body text: pdf2md heuristically removes repetitive elements and page numbers. Use the original PDF to verify headers, footnotes, tables, labels, and quotations. Some text-layer PDFs also yield stray control characters; preserve the raw extraction and document any cleanup separately.

## Escalation Order: Local First, Hosted OCR Last

1. **First pass: pdf2md.** Use the public package above for the initial conversion and verify the result. A filename bug, missing dependency, or installation error is not evidence that the PDF needs hosted OCR; fix the invocation first.
2. **Local recovery.** Identify the exact pages and failure mode. Try a local page-aware extractor such as `pdftotext -layout` or PyMuPDF for an existing text layer. For scanned/image-only pages, try available local OCR, such as OCRmyPDF/Tesseract. Do not require a heavyweight installation without discussing its cost with the operator; record why a local option is unavailable or unsuitable.
3. **Last resort: Mistral's hosted PDF OCR service.** Propose this only for difficult documents whose needed text remains missing, illegible, or structurally unusable after reasonable local recovery, or where local OCR is not feasible. It is not the default converter, an automatic fallback, or an excuse to send the entire collection remotely. A configured key does not authorize an upload.

Keep a short failure record: source PDF, physical pages affected, methods tried, observed defects, and why further local recovery is unlikely to help. Never interpret an empty extraction as an empty document. If the operator declines hosted processing, mark the affected pages blocked and continue with the usable local results.

## Last Resort: Guide the Operator Through Mistral OCR

### Explain Before Asking for Credentials

Use plain language, adapted to the operator's experience:

> OCR means optical character recognition: reading the visible letters in a scanned page or image and turning them into searchable text. pdf2md normally reads text already stored inside a PDF. These pages did not produce usable text with our local methods. Mistral offers a hosted OCR service that may handle them better, but it means sending document content to Mistral and may incur a per-page charge. OCR can still misread names, numbers, and tables; we will check its output against the original.

State which document and pages failed and show a concrete example. Explain that an API key is a secret credential allowing software to use the operator's Mistral account and potentially incur charges; it is not a PDF password or a chat subscription. Do not begin account setup merely because a PDF exists.

### Obtain Informed Approval

Before any upload or billable request:

- Identify the exact documents/pages, the content that will leave the machine, and the purpose. Even a publicly available city document can contain personal information; do not assume publication grants approval for third-party processing.
- Review the current official pricing, model availability, request limits, and applicable data-handling terms with the operator. Do not promise free OCR, confidentiality, deletion, retention periods, or training exclusions without verifying the applicable terms.
- Calculate a page-based cost estimate with a tool using the current rate; agree on a spending ceiling, a small pilot, and a maximum number of attempts. Include potential retries. Do not silently enable paid billing or change account limits.
- Prefer a locally extracted PDF containing only the failed pages. Explain that the API's page-selection parameter limits processing, not what is disclosed: supplying the whole PDF still sends or exposes the whole PDF. Keep an explicit subset-page-to-original-page mapping.
- Ask for explicit permission to send that content to Mistral within that budget. Pause if permission, confidentiality, or cost is unresolved. This skill's instructions are not standing authorization.

### Help the Operator Obtain and Store a Key

1. Direct the operator to https://console.mistral.ai and the official [API-key setup guide](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key). Have them sign in or create an account themselves and select the intended organization/workspace. Walk them through one step at a time if needed; do not guess credentials or complete payment/terms acceptance on their behalf.
2. In Studio, open **API Keys**, choose **Create new key**, give it a recognizable project name, and set a suitable expiration. Use the least access needed. The current guide says the full key is shown only once; have the operator save it immediately in their password manager or secrets manager. UI labels and plans may change, so consult the live guide rather than inventing missing steps.
3. Ask the operator to make the key available to the agent's actual runtime as `MISTRAL_API_KEY`, using an approved secret manager or a privately edited, Git-ignored local environment file in the data workspace. Explain that an environment variable is a named setting a program reads, and that a `.env` file is not automatically loaded by every command. If they configure another terminal, an already-running agent will not necessarily inherit it.
4. Never ask them to paste the key into chat, put it in a command argument or shell history, or commit it. Never print the key, dump the environment, enable shell tracing, or log authorization headers. Check only whether the variable is set, not its value. If a key is exposed, stop and guide them through revoking/replacing it.
5. Confirm the chosen account can use OCR and has an acceptable quota/billing arrangement. Do not assume a chat subscription includes API usage, or that a free account has sufficient OCR capacity. If setup is blocked, leave the documents blocked rather than substituting invented results.

### Run a Small Approved Pilot, Then Verify

Consult the official [OCR guide](https://docs.mistral.ai/capabilities/document_ai/basic_ocr) and [API reference](https://docs.mistral.ai/api/endpoint/ocr) immediately before implementation. Use the hosted `POST https://api.mistral.ai/v1/ocr` endpoint, not a general chat completion. The documented `mistral-ocr-latest` alias can change; record the requested model and the model returned in the response. Prefer a verified fixed model ID when reproducibility matters.

- Submit only the approved pilot subset using a supported local-PDF mechanism (Base64 document data or a private upload). Do not publish PDFs at public URLs as a workaround, and do not log Base64 request bodies. If using the upload API, track uploaded file IDs and follow the documented deletion procedure after use; do not claim this guarantees deletion from all provider systems.
- Set processing choices explicitly. For a simple searchable-text pass, use inline tables (`table_format: null`), keep header/footer extraction disabled so they remain in page content, and disable image Base64 output unless needed. Check the current model supports the chosen options. Separate table/header/footer fields must be preserved and incorporated if enabled; do not silently lose content referenced by placeholders.
- The `pages` request parameter uses zero-based page numbers. Preserve returned page indices and map them back to original physical PDF pages; never confuse subset indices or printed page labels with original physical pages.
- Save the raw response JSON, returned model, usage information, source hash, original-page mapping, and reviewed Markdown in the local data workspace. Keep the pdf2md result separately. Preserve page boundaries with explicit original physical-page labels; do not join noncontiguous OCR pages as if they were adjacent. Record the extraction method per page when merging local and hosted results.
- Visually compare the pilot with the original pages, especially names, dates, amounts, signs, decimal points, table columns, and footnotes. Plausible-looking text or a successful HTTP status is not proof of accuracy. Flag unreadable content instead of guessing.
- Expand only within the approved scope and spending ceiling after the pilot demonstrates improvement. Stop for authentication/billing errors, exhausted quota, or unclear quality. Bound rate-limit retries and backoff; do not blindly retry a timed-out paid request whose processing status is unknown. Reuse saved successful responses instead of paying again.

Recheck [official API pricing](https://docs.mistral.ai/inference/pricing) at run time rather than embedding a permanent price here. If no hosted request was made, say so; never describe an example payload or a local test as a verified Mistral conversion.

## Verification

1. Compare the full input manifest against actual output paths programmatically. Require one correctly named, nonempty Markdown file per intended PDF; list every failure or deliberate exclusion. A matching count alone does not prove the mapping is right.
2. Inspect conversion logs: the CLI catches per-file errors and can exit successfully despite missing outputs. Do not treat exit status zero as batch success or reuse stale files as evidence.
3. Check page coverage against a PDF-aware page count: for a nonempty pdf2md conversion, the marker count should be physical pages minus one. For Mistral subsets, compare returned page indices with the approved subset and original-page mapping instead; list gaps and duplicates. Inspect each page segment for missing text; blank/image-only pages need explicit review even if counts match.
4. Read representative output with `read_file`, including the first and last pages and a table-heavy section. Spot-check extracted names, dates, amounts, and quotations against the original PDF. Do not claim table fidelity from successful text extraction alone.
5. Report source and output locations, versions used, verified coverage, and any OCR or layout limitations. Retain PDFs and the source-to-output mapping for subsequent cited analysis.
