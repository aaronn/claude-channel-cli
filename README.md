# claude-cli-channel

`claude-cli-channel` sends messages from Codex, or any local shell, into a live Claude Code session.

It keeps both tools in their native harnesses:

- Claude Code runs in its normal terminal session.
- Codex runs in its normal environment.
- Messages arrive in the visible Claude Code thread.
- When Codex needs an answer, Claude Code replies through an MCP tool.

This is an early preview for local development and research-preview Claude Code Channels. Claude Code Channels require compatible Claude Code support and explicit channel enablement. See the official [Claude Channels reference](https://code.claude.com/docs/en/channels-reference) for the current contract.

## What Works

- Claude Code plugin packaging through `.claude-plugin/plugin.json`
- Codex plugin packaging through `.codex-plugin/plugin.json`
- Codex MCP tools: `list_claude_targets`, `status_claude_channel`, `tell_claude`, `ask_claude`
- CLI commands: `list`, `status`, `tell`, `tell-file`, `ask`, `ask-file`
- `send` and `send-file` aliases for `tell` and `tell-file`
- multiple live Claude Code endpoints with explicit `--to` targeting

Planned but not implemented: user-owned labels, persistent current-target config, and richer diagnostics such as `doctor`.

## Install From Source

```sh
git clone <repo-url>
cd claude-cli-channel
npm install
npm run build
npm link
```

The source checkout provides:

- the Claude Code plugin/channel receiver
- the Codex plugin and `claude-channel` sender interfaces

## Configure Claude Code

The Claude plugin manifest lives at `.claude-plugin/plugin.json`. It packages the channel server as an MCP server using `${CLAUDE_PLUGIN_ROOT}/dist/channel.js`.

Validate local plugin packaging:

```sh
npm run build
claude plugin validate . --strict
claude --plugin-dir .
```

`--plugin-dir` checks plugin loading. It is not the current end-to-end channel smoke test.

Until this project has a marketplace or npm release target, use the bare-MCP development fallback for end-to-end channel testing:

```sh
export CLAUDE_CLI_CHANNEL_DIR="/path/to/claude-cli-channel"
claude \
  --mcp-config "$CLAUDE_CLI_CHANNEL_DIR/.mcp.example.json" \
  --dangerously-load-development-channels server:claude-cli-channel
```

`.mcp.example.json` points Claude Code at this checkout:

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

If a receiver project should load the channel persistently, copy that JSON into the receiver project as `.mcp.json`. Do not overwrite this repository's checked-in `.mcp.json`; it is for Codex plugin packaging.

Future marketplace flow:

```text
/plugin install claude-cli-channel@<marketplace>
claude --channels plugin:claude-cli-channel@<marketplace>
```

TODO: Add `.claude-plugin/marketplace.json` after the repo URL, package source, marketplace name, and release policy are finalized.

## Configure Codex

The Codex plugin manifest lives at `.codex-plugin/plugin.json`. It packages:

- `skills/claude-cli-channel/SKILL.md` for `@claude-cli-channel` workflow guidance
- `.mcp.json` for the Codex MCP server
- `dist/codex-mcp.js` for typed Codex-facing tools

The Codex MCP tools are:

- `list_claude_targets`
- `status_claude_channel`
- `tell_claude`
- `ask_claude`

From Codex Desktop, use the plugin through `@claude-cli-channel`:

```text
@claude-cli-channel ask Claude Code to review the current branch for correctness and test coverage. After it responds, decide which findings you agree with.
```

Codex should send only the Claude-facing prompt through the tool. Follow-up instructions such as “then decide whether you agree” remain Codex-local handling instructions.

## CLI Usage

In another shell, after starting Claude Code with the channel enabled:

```sh
claude-channel list
claude-channel status
claude-channel tell "From Codex: hello from the local channel smoke test."
claude-channel ask "From Codex: reply through complete_channel_request."
```

If `claude-channel` is not available, run `npm link` once from this checkout.

List live targets:

```sh
claude-channel list
claude-channel list --json
```

Send a one-way message:

```sh
claude-channel tell "From Codex: summarize your current state and wait."
printf '%s\n' "From Codex: here is a longer note." | claude-channel tell-file -
```

Ask for a response:

```sh
claude-channel ask "From Codex: review this and complete the request."
```

`ask` defaults to a 30-minute timeout. While waiting, progress goes to stderr every 30 seconds; stdout remains Claude's final answer text.

Use `--output json` when a script needs the full response envelope:

```sh
claude-channel ask --output json "From Codex: review this."
```

For long prompts, use stdin or an explicit prompt file:

```sh
claude-channel ask-file - <<'EOF'
From Codex: /review the current branch for correctness, test coverage, and maintainability.
Return the final review by calling complete_channel_request.
EOF

claude-channel ask-file prompts/review.md
```

For very large CLI-fallback reviews, redirect the answer text to a visible file:

```sh
claude-channel ask-file - > claude-review.md
```

Completion status exit codes:

```text
0 answered
1 CLI, transport, or server error
3 needs_user
4 declined
5 failed
```

Timeouts:

```sh
claude-channel ask --timeout 45m "From Codex: take up to 45 minutes to review this."
CLAUDE_CHANNEL_ASK_TIMEOUT_MS=2700000 claude-channel ask "From Codex: review this."
```

Malformed numeric environment values fall back to defaults. Explicit CLI timeout flags fail fast when invalid.

## Targeting

Each channel-enabled Claude Code window registers a local endpoint record under:

```text
~/.claude-channel/endpoints/ep_<id>.json
```

When exactly one endpoint is live, `--to` is optional. When more than one endpoint is plausible, the command fails closed and prints candidates.

Target resolution order:

```text
--to
CLAUDE_CHANNEL_TARGET
unique workspace match
exactly one live endpoint
error
```

Examples:

```sh
claude-channel ask --to ep_ABC234 "From Codex: review this diff."
claude-channel tell --to 2 "From Codex: the test run completed."
CLAUDE_CHANNEL_TARGET=ep_ABC234 claude-channel status
```

`--to` accepts an endpoint id, a unique display name, a project path, or a numeric index from `claude-channel list`.

The channel does not infer targets from branches, task names, terminal titles, or Claude Code transcript names.

## Protocol Notes

`tell` is one-way:

```text
caller -> POST /tell -> channel notification -> Claude Code window
```

`ask` is synchronous:

```text
caller -> POST /ask -> channel notification with request_id
Claude Code -> complete_channel_request(request_id, status, answer)
pending request resolves -> caller receives answer
```

The raw HTTP response is JSON. The CLI renders `ask` responses as answer text by default and as the full envelope with `--output json`.

Metadata keys must match:

```text
^[A-Za-z0-9_]+$
```

Metadata values must be non-empty strings of at most 200 characters and cannot contain control characters or these attribute-breaking characters:

```text
< > " ' `
```

Unsafe `sender` metadata falls back to `codex`.

## Security

The default HTTP listener binds to `127.0.0.1` and asks the operating system for an available local port.

On first run, `claude-cli-channel` creates a bearer token at:

```text
~/.claude-channel/token
```

Sender clients read that token and send it in the `Authorization` header.

Override the port only for focused debugging:

```sh
CLAUDE_CHANNEL_PORT=8790 claude --dangerously-load-development-channels server:claude-cli-channel
```

`CLAUDE_CHANNEL_HOST` is available for advanced local testing. Binding to anything other than `127.0.0.1` can expose a prompt-injection surface to other machines. Do not use a remote listener without an explicit access-control model.

## Non-Goals

`claude-cli-channel` is intentionally not:

- an async mailbox
- a team or role router
- a terminal scraper
- a transcript-file editor
- a custom Claude/Codex harness
- a direct Claude API wrapper

## Development

```sh
npm run check:local
```

`npm run check:local` includes TypeScript checks, tests, `npm audit`, Claude plugin validation, and package dry-run.

CI intentionally stays Node-only because GitHub Actions runners do not have Claude Code or Codex plugin validation installed by default.

Codex plugin workflow guidance lives in `skills/claude-cli-channel/SKILL.md`.

See [Codex skills guidance](https://developers.openai.com/codex/explore) for the broader skills model.
