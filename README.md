# claude-channel-cli

`claude-channel-cli` sends messages from Codex, or any local shell, into a live Claude Code session.

Claude Code stays in its normal terminal session. Codex stays in its normal environment. Messages arrive in the visible Claude Code thread, and `ask` requests return through Claude Code's `complete_channel_request` tool.

This is an early preview for local development and research-preview Claude Code Channels. Claude Code Channels require compatible Claude Code support and explicit channel enablement. See the official [Claude Channels reference](https://code.claude.com/docs/en/channels-reference).

## Install the sender CLI

Install the sender CLI from npm:

```sh
npm install -g claude-channel-cli
```

This makes `claude-channel` available on your `PATH`.

## Start Claude Code

Claude Channel is not approved by Anthropic's marketplace yet. For now, register the receiver-side MCP server once from the project that should receive messages:

```sh
claude-channel setup-mcp
```

This uses Claude Code's `claude mcp add` command and defaults to local scope, which is private to you and active only for the current project. Then start Claude Code from the project that should receive messages:

```sh
claude --dangerously-load-development-channels server:claude-channel-cli
```

Use `--force` to replace an existing entry at the same scope, or `--scope user` to register the server for all projects:

```sh
claude-channel setup-mcp --force
claude-channel setup-mcp --scope user
```

### Claude plugin install

If the plugin is later available from a Claude plugin marketplace, install it from inside Claude Code:

```text
/plugin install claude-channel-cli@<marketplace>
/reload-plugins
```

Then exit Claude Code and restart it from the project that should receive messages:

```sh
cd /path/to/receiver-project
claude --dangerously-load-development-channels plugin:claude-channel-cli@<marketplace>
```

After allowlist approval, the startup command becomes:

```sh
claude --channels plugin:claude-channel-cli@<marketplace>
```

### Development install

For local development from a source checkout, build and link the package:

```sh
git clone https://github.com/aaronn/claude-channel-cli.git
cd claude-channel-cli
npm install
npm run build
npm link
```

`npm link` makes the checkout's `claude-channel` and `claude-channel-server` binaries available on your `PATH`. Then register the linked server from the receiver project:

```sh
cd /path/to/receiver-project
claude-channel setup-mcp --force
claude --dangerously-load-development-channels server:claude-channel-cli
```

The Claude plugin manifest lives at `.claude-plugin/plugin.json`. For local development, first validate that packaging:

```sh
npm run build
claude plugin validate . --strict
claude --plugin-dir .
```

`--plugin-dir` checks plugin loading. `.mcp.example.json` is only a template if you need to inspect or hand-build the MCP config.

## Use the CLI

In another shell, after starting Claude Code with the channel enabled:

```sh
claude-channel list
claude-channel status
claude-channel tell "From Codex: hello from the local channel smoke test."
claude-channel ask "From Codex: reply through complete_channel_request."
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

`ask` defaults to a 30-minute timeout. The HTTP client waits 60 seconds longer so the bridge can return its own timeout response first. Waiting progress goes to stderr every 30 seconds; stdout remains Claude's final answer text. Use `--output json` when a script needs the full response envelope:

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

Timeouts can be configured per command or through the environment:

```sh
claude-channel ask --timeout 45m "From Codex: take up to 45 minutes to review this."
CLAUDE_CHANNEL_ASK_TIMEOUT_MS=2700000 claude-channel ask "From Codex: review this."
```

When using the Codex plugin, keep the MCP tool timeout outside the ask timeout too. The bundled Codex MCP config uses `tool_timeout_sec: 1920`, giving the 30-minute ask timeout two minutes of outer margin.

## Codex Desktop

The Codex plugin is optional. It gives `@claude-channel-cli` workflow guidance and typed tools that mirror the CLI commands, so Codex can list targets, check status, tell Claude, and ask Claude without shell quoting or CLI-output parsing.

Use it when you want Codex to ask Claude Code and then handle the response:

```text
@claude-channel-cli ask Claude Code to review the current branch for correctness and test coverage. After it responds, decide which findings you agree with.
```

Codex should send only the Claude-facing prompt through the channel. Follow-up instructions such as “then decide which findings you agree with” are Codex-local handling instructions.

The same workflow works without the Codex plugin by asking Codex to run `claude-channel ask`, `ask-file -`, `tell`, `status`, or `list`.

## Targeting

Each channel-enabled Claude Code window registers a local endpoint under:

```text
~/.claude-channel/endpoints/ep_<id>.json
```

When exactly one endpoint is live, `--to` is optional. When more than one endpoint is plausible, commands fail closed and print candidates:

```sh
claude-channel list
claude-channel ask --to ep_ABC234 "From Codex: review this diff."
claude-channel tell --to 2 "From Codex: the test run completed."
CLAUDE_CHANNEL_TARGET=ep_ABC234 claude-channel status
```

`--to` accepts an endpoint id, a unique display name, a project path, or a numeric index from `claude-channel list`.

## Security

The channel is a local control surface for a live Claude Code session. It does not expose a remote API by default, but any local process with the bearer token can send messages into the visible Claude Code thread.

The default HTTP listener binds to `127.0.0.1` and asks the operating system for an available local port. Requests to `/tell` and `/ask` require a bearer token. On first run, `claude-channel-cli` creates that token at:

```text
~/.claude-channel/token
```

Sender clients read the same token file and send it in the `Authorization` header. Treat the token as local credentials; a process that can read it can inject prompts into the Claude Code session. Remove the token file when no channel is running to rotate it.

`CLAUDE_CHANNEL_HOST` is available for advanced local testing. Binding to anything other than `127.0.0.1` can expose that prompt-injection surface to other machines. Do not use a remote listener without an explicit access-control model.

## Development

```sh
npm run check
npm run check:local
```

`npm run check` runs version alignment, linting, TypeScript checks, and tests. `npm run check:local` also runs `npm audit`, Claude plugin validation, and a package dry-run.

CI intentionally stays Node-only because GitHub Actions runners do not have Claude Code or Codex plugin validation installed by default.
