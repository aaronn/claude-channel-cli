# claude-channel-cli

`claude-channel-cli` asks a live Claude Code session questions from Codex, Claude Code, or any local shell and returns Claude's response to the caller. Because it's built on the Channels feature, Claude Code can tell the request came from another agent and can respond through the channel without mixing that response into your normal chat.

Unlike using the API directly or a sub-agent, this gives you full auditability and steerability. For example, Codex can submit a plan to Claude for review while you keep watching and steering that same Claude Code session.


## Install the CLI

Install the CLI from npm:

```sh
npm install -g claude-channel-cli
```

This makes the `claude-channel` command available on your `PATH`.


## Start Claude Code

Claude Channel is not approved by Anthropic's marketplace yet. For now, register the receiver-side MCP server once from each project directory where you want Claude Code to receive channel requests:

```sh
cd ~/github/my_project/
claude-channel setup-mcp
```

Then start Claude Code from that same project, or resume a thread there. The explicit channel flag is required until the plugin is available through Anthropic's marketplace:

```sh
claude --dangerously-load-development-channels server:claude-channel-cli
```


## Use the CLI

In another shell, ask the channel-enabled Claude Code session:

```sh
claude-channel list
claude-channel status
claude-channel ask "From Codex: reply through complete_channel_request."
```

`ask` defaults to a 30-minute timeout. Use `--output json` when a script needs the full response envelope:

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


## Use the Codex Desktop Plugin

The Codex plugin gives `@claude-channel` workflow guidance and typed tools that mirror the CLI commands, so Codex can list targets, check status, and ask Claude without shell quoting or CLI-output parsing.

After installing the npm package, register the bundled Codex plugin in your personal marketplace, then install it. `setup-codex-plugin` preserves existing marketplace entries and fails if `claude-channel-cli` already exists but points somewhere unexpected. If it prints a different `codex plugin add ...` command, use the printed command. Then start a new Codex thread.

```sh
claude-channel setup-codex-plugin
codex plugin add claude-channel-cli@personal
```

Use it when you want Codex to ask Claude Code and then handle the response:

```text
@claude-channel ask Claude Code to review the current branch for correctness and test coverage. After it responds, decide which findings you agree with.
```

Codex can also alternatively use the CLI directly.


## Multiple Sessions & Targeting

Each channel-enabled Claude Code window registers a local endpoint under:

```text
~/.claude-channel/endpoints/ep_<id>.json
```

When exactly one endpoint is live, `--to` is optional. When more than one endpoint is live, commands fail closed and print candidates instead of guessing:

```sh
claude-channel list
claude-channel ask --to ep_ABC234 "From Codex: review this diff."
CLAUDE_CHANNEL_TARGET=ep_ABC234 claude-channel status
```

`--to` accepts an endpoint id, a unique display name, a project path, or a numeric index from the current `claude-channel list` output.

Use `rename` to make same-project sessions predictable:

```sh
claude-channel rename --to ep_ABC234 review-left
claude-channel ask --to review-left "From Codex: review this diff."
```

For scripted launches, set the startup display name before starting Claude Code:

```sh
CLAUDE_CHANNEL_DISPLAY_NAME=review-left claude --dangerously-load-development-channels server:claude-channel-cli
```

Display names cannot be only digits, look like endpoint ids, or contain control/formatting characters, because numeric targets, endpoint ids, and invisible text are reserved for safe targeting.


## Security

The channel is a local control surface for a live Claude Code session. It does not expose a remote API by default, but any local process with the bearer token can ask the visible Claude Code thread to act.

The default HTTP listener binds to `127.0.0.1` and asks the operating system for an available local port. Requests to `/ask` require a bearer token. On first run, `claude-channel-cli` creates that token at:

```text
~/.claude-channel/token
```

CLI clients read the same token file and pass it in the `Authorization` header. Treat the token as local credentials; a process that can read it can inject prompts into the Claude Code session. Remove the token file when no channel is running to rotate it.

`CLAUDE_CHANNEL_HOST` is available for advanced local testing. Binding to anything other than `127.0.0.1` can expose that prompt-injection surface to other machines. Do not use a remote listener without an explicit access-control model.


## Development install

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


Quick checks:

```sh
npm run check
npm run check:local
```

`npm run check` runs version alignment, linting, TypeScript checks, and tests. `npm run check:local` also runs `npm audit`, Claude plugin validation, and a package dry-run.


## Release

Publishing is automated by `.github/workflows/publish.yml` when a `vX.Y.Z` tag is pushed. Before the first automated publish, configure npm Trusted Publishing for the package:

- Provider: GitHub Actions
- Organization or user: `aaronn`
- Repository: `claude-channel-cli`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`
- Environment: blank

The workflow verifies that the tag version matches `package.json`, that the tagged commit is on `main`, and that checks, audit, and package dry-run pass before publishing.

After merging a release-ready version bump to `main`, publish the matching tag:

```sh
git switch main
git pull --ff-only
VERSION="$(node -p "require('./package.json').version")"
git tag "v$VERSION"
git push origin "v$VERSION"
```
