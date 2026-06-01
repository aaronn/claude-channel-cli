# claude-cli-channel

`claude-cli-channel` sends messages from Codex, or any local shell, into a live Claude Code window.

The project keeps both native harnesses:

- Claude Code runs in its normal terminal session.
- Codex runs in its normal environment.
- Messages arrive in the visible Claude Code thread instead of creating a separate API conversation.
- When Codex needs an answer, Claude Code replies through an MCP tool and Codex receives the result.

## Status

This is an early preview for local development and research-preview Claude Code Channels.

Claude Code Channels currently require a compatible Claude Code version and channel enablement. Custom channels are tested with Claude Code's development-channel flag. See the official [Claude Channels reference](https://code.claude.com/docs/en/channels-reference) for the current channel contract and requirements.

Working today:

- one live Claude Code channel endpoint
- `status`
- `tell`
- `tell-file`
- `ask`
- `ask-file`
- `send` and `send-file` aliases

Planned next:

- multiple live Claude Code windows
- `list`, `label`, `use`, `current`, and `--to`
- Codex-side MCP tools: `tell_claude`, `ask_claude`, and `list_claude_targets`

## Mental Model

Open Claude Code normally, but with the `claude-cli-channel` channel enabled. That Claude Code window becomes the single live channel endpoint for this preview.

Then send into that same visible Claude Code thread:

```sh
claude-channel tell "From Codex: here is some context."
```

Or ask Claude Code for a response:

```sh
claude-channel ask "From Codex: review this plan and reply with your recommendation."
```

`tell` is one-way. It delivers the message and returns.

`ask` waits for Claude Code to call `complete_channel_request` with the request id from the message.

## Install From Source

The source checkout provides two pieces:

- the Claude Code plugin/channel receiver
- the `claude-channel` sender CLI used by Codex or any local shell

```sh
git clone <repo-url>
cd claude-cli-channel
npm install
npm run build
npm link
```

## Configure Claude Code

There are three separate lifecycle steps: package validation, plugin loading, and channel-enabled runtime.

### 1. Validate Plugin Packaging

The conventional Claude Code plugin manifest lives at `.claude-plugin/plugin.json`. It packages the channel server as a plugin MCP server using `${CLAUDE_PLUGIN_ROOT}/dist/channel.js`.

```sh
npm run build
claude plugin validate . --strict
```

For local plugin development, `--plugin-dir` verifies that Claude Code can load the plugin directory:

```sh
claude --plugin-dir .
```

This checks plugin loading. It is not the full end-to-end channel smoke test.

### 2. Run The Current Local Channel Smoke Test

Until this project has a marketplace or npm release target, use the bare-MCP development fallback for end-to-end channel testing. Copy `.mcp.example.json` to the Claude Code project as `.mcp.json`. Claude Code supports environment-variable expansion in `.mcp.json`; use that for machine-specific paths:

```json
{
  "mcpServers": {
    "claude-cli-channel": {
      "command": "node",
      "args": ["${CLAUDE_CLI_CHANNEL_DIR}/dist/channel.js"]
    }
  }
}
```

Then set the path before starting Claude Code:

```sh
export CLAUDE_CLI_CHANNEL_DIR="$PWD"
claude --dangerously-load-development-channels server:claude-cli-channel
```

In another shell, use the sender CLI:

```sh
claude-channel status
claude-channel tell "From Codex: hello from the local channel smoke test."
claude-channel ask "From Codex: reply through complete_channel_request."
```

### 3. Future Marketplace Channel Flow

Once this is published through a Claude plugin marketplace, the intended user flow is:

```text
/plugin install claude-cli-channel@<marketplace>
claude --channels plugin:claude-cli-channel@<marketplace>
```

TODO: Add `.claude-plugin/marketplace.json` after the repo URL, package source, marketplace name, and release/version policy are finalized.

During the research preview, custom channel plugins that are not on an allowlist still need Claude Code's development-channel bypass for local testing. See the official [Claude Channels reference](https://code.claude.com/docs/en/channels-reference) for the current channel contract and startup rules.

For more on Claude Code MCP configuration, see the official [Claude MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp).

The channel server binds to `127.0.0.1:8788` by default. Override the port when needed:

```sh
CLAUDE_CHANNEL_PORT=8790 claude --dangerously-load-development-channels server:claude-cli-channel
```

`CLAUDE_CHANNEL_HOST` is also available for advanced local testing, but binding to anything other than `127.0.0.1` can expose a prompt-injection surface to other machines. Do not use a remote listener unless you have designed and reviewed an explicit access-control model.

## Use It Today

Check whether the channel is running:

```sh
claude-channel status
```

Send a one-way message:

```sh
claude-channel tell "From Codex: summarize your current state and wait."
```

Send generated multiline input through stdin:

```sh
printf '%s\n' "From Codex: here is a longer note." | claude-channel tell-file -
```

Ask for a response:

```sh
claude-channel ask "From Codex: review this and complete the request."
```

`ask` defaults to a 30-minute timeout for review-sized requests. While waiting, the CLI writes progress to stderr every 30 seconds; stdout remains the final JSON response.

Ask with generated multiline input:

```sh
claude-channel ask-file - <<'EOF'
From Codex: /review the current branch for correctness, test coverage, and maintainability.
Return the final review by calling complete_channel_request.
EOF
```

Ask with a reusable prompt file owned by the user/project:

```sh
claude-channel ask-file prompts/review.md
```

Set a custom ask timeout:

```sh
claude-channel ask --timeout 45m "From Codex: take up to 45 minutes to review this."
```

Set a global default for the channel server and CLI:

```sh
CLAUDE_CHANNEL_ASK_TIMEOUT_MS=2700000 claude-channel ask "From Codex: review this."
```

Compatibility aliases:

```sh
claude-channel send "Same as tell."
printf '%s\n' "Same as tell-file." | claude-channel send-file -
```

## Future UX

The public UX we are building toward treats each live Claude Code window as an explicit target.

Daily flow:

```sh
claude-channel list
claude-channel label ep_abc123 main
claude-channel use main

claude-channel tell "Here is context from Codex."
claude-channel ask "Review this plan and give Codex your answer."
```

Targeted use:

```sh
claude-channel ask --to main "Please review this diff."
claude-channel tell --to ep_def456 "FYI: Codex finished the local test run."
```

Expected target resolution:

```text
--to
CLAUDE_CHANNEL_TARGET
configured current target
exactly one live endpoint
error
```

The channel should not infer targets from repo, branch, terminal title, cwd, or Claude Code transcript names. Labels are user-owned aliases.

## Non-Goals

`claude-cli-channel` is intentionally not:

- an async mailbox
- a team or role router
- a terminal scraper
- a transcript-file editor
- a custom Claude/Codex harness
- a direct Claude API wrapper

## Security

The default HTTP listener binds to localhost only.

On first run, `claude-cli-channel` creates a bearer token at:

```text
~/.claude-channel/token
```

The CLI reads that token and sends it in the `Authorization` header.

The preview channel server writes single-endpoint connection state to:

```text
~/.claude-channel/state.json
```

The planned multi-window registry will move live endpoints to:

```text
~/.claude-channel/endpoints/ep_<id>.json
```

## Development

```sh
npm run check:local
```

`npm run check:local` includes TypeScript checks, tests, `npm audit`, Claude plugin validation, and package dry-run. CI intentionally stays Node-only because GitHub Actions runners do not have Claude Code installed by default.

Codex contributor workflow guidance lives in `.agents/skills/claude-cli-channel/SKILL.md`. See [Codex skills guidance](https://developers.openai.com/codex/explore) for the broader skills model.

## Docs

- [Architecture](docs/architecture.md)
- [UX](docs/ux.md)
- [Protocol](docs/protocol.md)
- [Software pattern references](docs/software-patterns.md)
- [Prior art research](docs/prior-art.md)
