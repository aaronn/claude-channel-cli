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

- multiple live Claude Code channel endpoints with explicit target selection
- Codex plugin packaging through `.codex-plugin/plugin.json`
- Codex MCP tools: `list_claude_targets`, `status_claude_channel`, `tell_claude`, and `ask_claude`
- `list`
- `status`
- `tell`
- `tell-file`
- `ask`
- `ask-file`
- `--to` target selection for status/tell/ask commands
- `send` and `send-file` aliases

Planned next:

- user-owned labels
- persistent `use` / `current` target config
- richer diagnostics such as `doctor` and explicit stale-record pruning commands

## Mental Model

Open Claude Code normally, but with the `claude-cli-channel` channel enabled. Each channel-enabled Claude Code window registers a local endpoint record under `~/.claude-channel/endpoints/`.

If exactly one endpoint is live, `claude-channel` can target it automatically. If more than one endpoint is plausible, the command fails closed and asks for an explicit target.

List live targets:

```sh
claude-channel list
```

Then send into a visible Claude Code thread:

```sh
claude-channel tell "From Codex: here is some context."
```

Or ask Claude Code for a response:

```sh
claude-channel ask "From Codex: review this plan and reply with your recommendation."
```

`tell` is one-way. It delivers the message and returns.

`ask` waits for Claude Code to call `complete_channel_request` with the request id from the message.

In Codex Desktop, the preferred interface is the bundled Codex plugin. `@claude-cli-channel` loads the skill guidance, and Codex can call the plugin MCP tools directly instead of synthesizing shell commands.

## Install From Source

The source checkout provides two pieces:

- the Claude Code plugin/channel receiver
- the Codex plugin and `claude-channel` sender interfaces that post into that receiver

```sh
git clone <repo-url>
cd claude-cli-channel
npm install
npm run build
npm link
```

## Configure Codex

The Codex plugin manifest lives at `.codex-plugin/plugin.json`. It packages:

- `skills/claude-cli-channel/SKILL.md` for `@claude-cli-channel` workflow guidance
- `.mcp.json` for the Codex MCP server
- `dist/codex-mcp.js` for typed Codex-facing tools

The Codex MCP server exposes:

- `list_claude_targets`
- `status_claude_channel`
- `tell_claude`
- `ask_claude`

The checked-in `.mcp.json` belongs to Codex plugin packaging. For Claude Code bare-MCP channel development, use `.mcp.example.json` in the separate Claude Code receiver project you are testing. If you intentionally use this checkout itself as the Claude receiver project, temporarily swap the local `.mcp.json` and do not commit that machine-local change.

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

Until this project has a marketplace or npm release target, use the bare-MCP development fallback for end-to-end channel testing. Copy `.mcp.example.json` to the Claude Code project you want to run as the Claude receiver, naming it `.mcp.json` there. Claude Code supports environment-variable expansion in `.mcp.json`; use that for machine-specific paths:

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
claude-channel list
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

The channel server binds to `127.0.0.1` and asks the operating system for an available local port by default. Override the port only for focused development or debugging:

```sh
CLAUDE_CHANNEL_PORT=8790 claude --dangerously-load-development-channels server:claude-cli-channel
```

Fixed ports are not recommended when multiple Claude Code windows may run at the same time.

`CLAUDE_CHANNEL_HOST` is also available for advanced local testing, but binding to anything other than `127.0.0.1` can expose a prompt-injection surface to other machines. Do not use a remote listener unless you have designed and reviewed an explicit access-control model.

## Use It Today

From Codex Desktop, use the plugin tools through `@claude-cli-channel`:

```text
@claude-cli-channel ask Claude Code to review the current branch for correctness and test coverage. After it responds, decide which findings you agree with.
```

Codex should check `list_claude_targets` or `status_claude_channel`, choose an explicit target when more than one Claude Code window is live, then use `ask_claude` or `tell_claude` as appropriate. The CLI remains the human shell and fallback interface.

List live Claude Code channel targets:

```sh
claude-channel list
claude-channel list --json
```

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

Send to an explicit live target when multiple Claude Code windows are running:

```sh
claude-channel ask --to ep_ABC234 "From Codex: review this diff."
claude-channel tell --to 2 "From Codex: the test run completed."
CLAUDE_CHANNEL_TARGET=ep_ABC234 claude-channel status
```

`--to` accepts an endpoint id, a unique display name, a project path, or a numeric index from the current `claude-channel list` output. Endpoint ids are the durable choice for scripts; numeric indexes are intended for interactive use.

Compatibility aliases:

```sh
claude-channel send "Same as tell."
printf '%s\n' "Same as tell-file." | claude-channel send-file -
```

## Targeting UX

The public UX treats each live Claude Code window as an explicit target.

Daily flow:

```sh
claude-channel list
claude-channel tell --to ep_ABC234 "Here is context from Codex."
claude-channel ask --to ep_ABC234 "Review this plan and give Codex your answer."
```

When exactly one live endpoint exists, `--to` is optional:

```sh
claude-channel ask "Please review this diff."
```

Expected target resolution:

```text
--to
CLAUDE_CHANNEL_TARGET
unique workspace match
exactly one live endpoint
error
```

The channel does not infer targets from branches, task names, terminal titles, or Claude Code transcript names. The only implicit routing rule is a conservative workspace match: if the current working directory is inside exactly one live endpoint's registered project directory, that endpoint may be selected. If more than one endpoint is plausible, the command fails and prints the candidate list.

Future labels and persistent current-target config should remain user-owned aliases, not endpoint metadata.

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

Sender clients read that token and send it in the `Authorization` header.

The preview channel server writes live endpoint records to:

```text
~/.claude-channel/endpoints/ep_<id>.json
```

Each endpoint record is process-owned liveness metadata containing host, port, pid, project directory, display name, start time, and last-seen time. The sender prunes stale or dead endpoint records while listing or resolving targets.

For compatibility and debugging during the preview, the channel server also writes the most recent endpoint to:

```text
~/.claude-channel/state.json
```

## Development

```sh
npm run check:local
```

`npm run check:local` includes TypeScript checks, tests, `npm audit`, Claude plugin validation, and package dry-run. CI intentionally stays Node-only because GitHub Actions runners do not have Claude Code or Codex plugin validation installed by default.

Codex plugin workflow guidance lives in `skills/claude-cli-channel/SKILL.md`. Repo-local contributor fallback guidance lives in `.agents/skills/claude-cli-channel/SKILL.md`. See [Codex skills guidance](https://developers.openai.com/codex/explore) for the broader skills model.

## Docs

- [Architecture](docs/architecture.md)
- [UX](docs/ux.md)
- [Protocol](docs/protocol.md)
- [Software pattern references](docs/software-patterns.md)
- [Prior art research](docs/prior-art.md)
