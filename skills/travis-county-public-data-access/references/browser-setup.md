# Browser automation setup for county workflows

## Choose the browser workflow, not a private skill dependency

These references describe normal public website operations. A human can perform them in an ordinary browser, and another approved browser-control tool can perform equivalent actions. **agent-browser is an optional automation implementation, not a requirement for public access.** Its command examples, snapshot refs and session flags are tool-specific; translate those mechanics when using another tool while preserving source filters, acquisition bounds, validation and stopping rules.

agent-browser is an external CLI. This repository does not install it or ship a private Hermes discovery skill. Its usage instructions are bundled with the installed CLI and can be loaded directly through the terminal tool; no separately installed agent skill is required.

## Install the CLI and managed Chrome

Use the [official installation guide](https://agent-browser.dev/installation) and [upstream source](https://github.com/vercel-labs/agent-browser). Choose ONE package manager, through the terminal tool:

```sh
# macOS with Homebrew
brew install agent-browser
```

Or, with npm in an environment that supports it:

```sh
npm install -g agent-browser
```

Then download the managed Chrome browser on first setup:

```sh
agent-browser install
```

Linux may also require browser system libraries: upstream provides `agent-browser install --with-deps`, which may require elevated package-manager authority. Obtain operator approval before system changes. On Windows, follow upstream's current installation guidance and translate the POSIX shell example below to PowerShell. Do not reinstall, upgrade, change package managers or use administrator privileges merely because a working installation already exists. The source workflows were exercised with version 0.41.2, not a requirement to downgrade another installation.

## Load the version-matched usage instructions

Through the terminal tool:

```sh
agent-browser --version
agent-browser skills get core
agent-browser skills get core --ref commands
```

These commands print instructions matching the installed CLI version. The [optional upstream discovery skill](https://agent-browser.dev/skills) can be installed in supported agent environments with `npx skills add vercel-labs/agent-browser`; it is not necessary for this repository's procedures. Do not copy private profile skills or credentials into the checkout.

## Prepare a private, owned session

Before opening a source:

1. Select an approved existing scratch/archive parent outside the checkout. Create a fresh private task directory (mode 0700 on POSIX), with a new private downloads subdirectory. Do not put original records, browser profiles or cookies in the repository.
2. Use the `write_file` tool or an equivalent local file editor to create a new `config.json` in that task directory containing exactly `{}`. Keep it private (0600 on POSIX). This explicit reviewed configuration avoids relying on unknown project configuration. Do not overwrite an existing config.
3. Review inherited `AGENT_BROWSER_*` environment overrides before launch without printing credential values. Remove unintended profile, provider, restore, plugin or init-script overrides in the task's subprocess only. Do not change shared settings or borrow another browser session.
4. Set `CONFIG` to that config's absolute path and `DOWNLOADS` to the private downloads directory. Both are operator-selected locations, not files supplied by this repository.

The following is a POSIX terminal-tool smoke test using those already prepared variables. Its PID-derived prefix avoids the shared default session. No county source is contacted:

```sh
SESSION="$(agent-browser session id --scope worktree --prefix "atxdata-setup-$$")"
agent-browser --config "$CONFIG" --session "$SESSION" --download-path "$DOWNLOADS" open about:blank
agent-browser --config "$CONFIG" --session "$SESSION" --download-path "$DOWNLOADS" eval 'location.href'
agent-browser --config "$CONFIG" --session "$SESSION" close
```

The open command should succeed, eval should return `about:blank`, and close should succeed. If an action fails, retain its diagnostic privately and inspect the owned session before retrying. An unsuccessful compound shell block is not proof that later cleanup ran; close only the owned session explicitly if needed. No package-manager or managed-browser installation is performed by this smoke test.

## Start a source-specific procedure

Create a fresh task session and use its literal `--session`, reviewed `--config` and private `--download-path` on every relevant command. Add `--headed` when an owned visible window is useful. Open only the actual official source from that procedure, take `snapshot -i`, then use current refs for fill/click/select. Refresh refs after navigation. Wait for visible controls/results and read back filters/counts; do not use generic network-idle waits for dashboards, SignalR or polling sites.

Do not reuse the smoke-test session after closing it as if it retained source state. Snapshot refs such as `@e12`, case IDs, source rows and coordinates in a historical observation are not reusable selectors or permission to broaden the query.

For a successful existing human browser, agree on an authorized attachment/control mechanism or have the human operate it. Do not restart it, enable debugging, alter profiles, import cookies or use auto-connect without approval. A managed-Chrome success/failure is not automatically evidence about the human's browser. Hosted browser services, paid providers and credential setup are optional separate decisions, not prerequisites for these local workflows.

## Safety, downloads and troubleshooting

- Preserve each procedure's source scope, filters, record/download ceilings and checks. Normal browser assets/background concurrency are allowed; deliberate searches and downloads remain polite. Standalone API collectors have separate serial/rate-limit requirements.
- Stop at CAPTCHA, login, identity disclosure, payment or explicit export denial; request the appropriate human handoff rather than bypassing the boundary. Installing browser automation does not make a blocked workflow available. Recording's operator-confirmed flow does not establish Odyssey success.
- Keep raw snapshots, contact/case fields, original documents, base64 receipts and access/session URLs private. Filter diagnostic output before printing. Browser Print/`agent-browser pdf` is a derivative, not an original source download.
- A click or timeout is not proof of a failed download. Inspect the owned tab and private output directory before another click; do not regenerate a report blindly. Validate actual saved bytes and source identity. Only use cache-only recovery where the source-specific procedure explicitly documents an already offered/loaded public original; never as a denied-export workaround.
- If the CLI/browser will not start, use `agent-browser doctor --offline --quick` and inspect its output. Do not use `--fix`, upgrade software, close unrelated sessions or restart the user's browser as an implicit repair.
- Close only the task-owned session when finished. No `close --all`, global profile mutation or automatic paid-provider fallback.

The setup smoke test is tool-readiness evidence only, not a county-data acquisition test. Follow the selected source reference for its separately verified capability and remaining gaps.
