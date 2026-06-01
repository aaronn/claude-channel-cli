# Contributor Instructions

This repository is an early-preview local bridge between Codex or shell callers and a live Claude Code session using Claude Code Channels.

## Setup

```sh
npm install
npm run build
```

For local Claude Code testing, configure `.mcp.json` with `CLAUDE_CLI_CHANNEL_DIR` pointing at this checkout, then start Claude Code with:

```sh
export CLAUDE_CLI_CHANNEL_DIR="$PWD"
claude --dangerously-load-development-channels server:claude-cli-channel
```

The `.claude-plugin/plugin.json` manifest is the canonical plugin packaging file. Use `claude --plugin-dir .` for plugin load checks, but use the bare-MCP development fallback above for the current end-to-end channel smoke test until a marketplace target exists.

## Quality Bar

- Keep the current single-endpoint architecture unless the task explicitly adds multi-window routing.
- Keep MCP stdout clean; diagnostics from the channel process must go to stderr.
- Preserve the public CLI commands unless a task explicitly changes the interface.
- Prefer small, focused modules over mixing CLI formatting, HTTP ingress, and MCP tool logic.
- Do not add a daemon, mailbox, terminal scraper, transcript editor, or direct Claude API wrapper.

## Verification

Run this before handing off changes:

```sh
npm run check:local
```

`npm run check:local` includes plugin validation. CI remains Node-only because Claude Code is not available on standard GitHub Actions runners by default.

Add or update tests for behavioral changes, especially request parsing, auth, pending request correlation, timeout behavior, and CLI-visible errors.

## Documentation

- Keep README examples portable; do not commit local absolute paths.
- Be explicit that Claude Code Channels are a research-preview feature.
- Separate implemented behavior from planned future UX.
- Keep security docs aligned with the localhost bearer-token threat model.
