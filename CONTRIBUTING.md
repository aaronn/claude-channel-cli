# Contributing

Thanks for working on `claude-cli-channel`.

This project is an early-preview local developer tool. It supports multiple live local endpoints through a file-backed registry, but it is not a production daemon, mailbox, or workflow router. Changes should keep that boundary clear.

## Local Setup

```sh
npm install
npm run build
```

Validate the Claude plugin packaging with:

```sh
npm run validate:plugin
claude --plugin-dir .
```

Codex plugin packaging lives in `.codex-plugin/plugin.json`, with root-level `skills/` and `.mcp.json`. The checked-in `.mcp.json` is for Codex plugin tools; use `.mcp.example.json` as the Claude Code receiver project's `.mcp.json` for channel smoke tests. If this checkout is also the receiver project, any temporary `.mcp.json` swap is machine-local and must not be committed.

For the current end-to-end channel smoke test, set `CLAUDE_CLI_CHANNEL_DIR` to this checkout and use `.mcp.example.json` as the Claude Code receiver project's `.mcp.json`:

```sh
export CLAUDE_CLI_CHANNEL_DIR="$PWD"
claude --dangerously-load-development-channels server:claude-cli-channel
```

The marketplace channel flow is deferred until this project has a real marketplace or package target.

## Development Checks

Run the full local check before opening a PR:

```sh
npm run check:local
```

`npm run check:local` runs TypeScript checks, tests, `npm audit`, Claude plugin validation, and package dry-run. CI remains Node-only because standard GitHub Actions runners do not include Claude Code.

## Change Expectations

- Keep the CLI, Codex MCP, and HTTP behavior documented in README and `docs/protocol.md`.
- Add focused tests for new behavior and bug fixes.
- Do not commit `dist/`, `node_modules/`, local tokens, state files, or machine-specific paths.
- Keep target resolution centralized in `src/channel-client` and endpoint lifecycle code in `src/registry`.
- Do not add labels, persistent current-target config, daemons, mailbox semantics, or hidden routing inference unless the change explicitly targets that milestone.

## Preview Status

Claude Code Channels are research preview. Docs and UX should state preview requirements clearly and should not imply this package is a stable production integration.
