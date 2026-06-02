# Contributor Instructions

This repository is an early-preview local bridge between Codex or shell callers and a live Claude Code session using Claude Code Channels.

## Setup

```sh
npm install
npm run build
```

For local Claude Code testing, configure `CLAUDE_CLI_CHANNEL_DIR` with this checkout, then start Claude Code from the receiver project with `.mcp.example.json` passed explicitly:

```sh
export CLAUDE_CLI_CHANNEL_DIR="/path/to/claude-cli-channel"
claude \
  --mcp-config "$CLAUDE_CLI_CHANNEL_DIR/.mcp.example.json" \
  --dangerously-load-development-channels server:claude-cli-channel
```

The `.claude-plugin/plugin.json` manifest is the canonical Claude plugin packaging file. The `.codex-plugin/plugin.json` manifest is the Codex plugin packaging file. Use `claude --plugin-dir .` for Claude plugin load checks, but use the bare-MCP development fallback above for the current end-to-end channel smoke test until a marketplace target exists.

The checked-in `.mcp.json` is for Codex plugin packaging. Copy `.mcp.example.json` into a receiver project as `.mcp.json` only when persistent local MCP config is explicitly wanted, and do not commit a temporary Claude receiver `.mcp.json` over this repository's checked-in file.

## Quality Bar

- Keep the current file-backed endpoint registry architecture unless a task explicitly justifies a daemon or mailbox.
- Keep target resolution in `src/channel-client`; do not duplicate routing rules in the CLI or Codex MCP adapter.
- Keep MCP stdout clean; diagnostics from the channel process must go to stderr.
- Preserve the public CLI commands unless a task explicitly changes the interface.
- Keep shared sender behavior in `src/channel-client`; keep CLI formatting in `src/cli`; keep Codex MCP tool schemas in `src/codex-mcp`.
- Prefer small, focused modules over mixing CLI formatting, HTTP ingress, and MCP tool logic.
- Do not add hidden target inference from branches, terminal titles, transcript names, or task names.
- Do not add a daemon, mailbox, terminal scraper, transcript editor, or direct Claude API wrapper.

## Verification

Run this before handing off changes:

```sh
npm run check:local
```

`npm run check:local` includes plugin validation. CI remains Node-only because Claude Code is not available on standard GitHub Actions runners by default.

Add or update tests for behavioral changes, especially request parsing, auth, pending request correlation, timeout behavior, endpoint registration, target resolution, Codex MCP tool behavior, and CLI-visible errors.

## Documentation

- Keep README examples portable; do not commit local absolute paths.
- Be explicit that Claude Code Channels are a research-preview feature.
- Separate implemented behavior from planned future UX.
- Keep security docs aligned with the localhost bearer-token threat model.
