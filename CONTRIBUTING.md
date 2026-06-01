# Contributing

Thanks for working on `claude-cli-channel`.

This project is an early-preview local developer tool. It is not a production multi-window router yet, and changes should keep that boundary clear.

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

For the current end-to-end channel smoke test, set `CLAUDE_CLI_CHANNEL_DIR` to this checkout and use the example MCP config:

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

- Keep the CLI and HTTP behavior documented in README and `docs/protocol.md`.
- Add focused tests for new behavior and bug fixes.
- Do not commit `dist/`, `node_modules/`, local tokens, state files, or machine-specific paths.
- Do not expand scope into multi-window routing unless the change explicitly targets that milestone.

## Preview Status

Claude Code Channels are research preview. Docs and UX should state preview requirements clearly and should not imply this package is a stable production integration.
