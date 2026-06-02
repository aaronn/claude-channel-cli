# Software Pattern References

This document captures non-agent prior art for `claude-cli-channel`. Agent bridge projects are useful for understanding Claude/Codex constraints, but they should not be treated as architectural exemplars.

## Research Weighting

Use references in this order:

1. Official Claude Code Channels and MCP contracts define what is possible.
2. Mature CLI tools define the UX and persistence posture.
3. Existing agent bridge projects define domain pitfalls, not default architecture.

This matters because many agent bridge projects combine transport, state, routing, UI, and orchestration in one process. `claude-cli-channel` should instead look like a conventional local developer tool with a small protocol core and thin interfaces.

## Reference Set

### CLI Guidelines

Sources:

- <https://clig.dev/>
- <https://devcenter.heroku.com/articles/cli-style-guide>

Patterns to adopt:

- Use a real argument parser.
- Primary command output goes to stdout.
- Diagnostics, progress, and errors go to stderr.
- Return zero on success and non-zero on failure.
- Prefer human-readable default output.
- Provide machine-readable output where useful.
- Keep success output brief but not silent for operations humans expect to confirm.
- Use flags for per-invocation behavior.
- Use environment variables for shell/session-scoped overrides.
- Use config files for stable user or project state.
- Follow a clear precedence order: flags > environment > project config > user config > system config.

Implications for `claude-cli-channel`:

```text
claude-channel list               # human table
claude-channel list --json        # machine-readable
claude-channel ask --to ep_ABC234 ... # explicit target override
CLAUDE_CHANNEL_TARGET=ep_ABC234 ...   # shell/session override
```

Do not prompt in agent-facing flows. Interactive selection can be added later for human terminals, but every prompt must have an equivalent flag or config path.

### GitHub CLI (`gh`)

Sources:

- <https://cli.github.com/manual/gh_help_formatting>
- <https://cli.github.com/manual/gh_config_set>

Patterns to adopt:

- Line/table output by default.
- `--json` for structured output.
- `--jq` and template support are useful, but optional.
- `config get/set/list` is conventional for persistent user config.
- Host/repo selection commonly follows explicit flag > inferred context > configured default.

Implications for `claude-cli-channel`:

- Start with `--json`; do not add `--jq` unless users actually need it.
- Keep config commands simple:

  ```sh
  claude-channel config get current
  claude-channel config set current main
  ```

- `current` should be inspectable and unsettable.

### kubectl

Sources:

- <https://kubernetes.io/docs/reference/kubectl/>
- <https://kubernetes.io/docs/reference/kubectl/generated/kubectl_config/kubectl_config_get-contexts/>
- <https://kubernetes.io/docs/reference/generated/kubectl/kubectl-commands>

Patterns to adopt:

- Contexts are explicit, listable, and switchable.
- `current-context` is a persisted default, not hidden process magic.
- Output supports human tables, `json`, `yaml`, `name`, and "wide" variants.
- Commands that operate on a target accept an explicit context override.

Implications for `claude-cli-channel`:

Use a context-like mental model, but name it in our domain:

```sh
claude-channel list
claude-channel current
claude-channel use <target>
claude-channel ask --to <target> ...
```

The active target should be displayed in `list`, similar to kubectl/docker active-context markers.

### Docker CLI Contexts

Sources:

- <https://docs.docker.com/engine/manage-resources/contexts/>
- <https://docs.docker.com/reference/cli/docker/context/use/>
- <https://docs.docker.com/reference/cli/docker/context/show/>

Patterns to adopt:

- A context bundles all endpoint information required to target a service.
- Context records are stored as metadata files.
- `context ls` marks the active context with an asterisk.
- `context use` writes a persistent default.
- Environment variables override persistent defaults for the current shell.
- A global flag overrides both for one command.

Implications for `claude-cli-channel`:

Endpoint records should be file-backed and inspectable:

```text
~/.claude-channel/endpoints/ep_<id>.json
```

Target precedence should be:

```text
--to
CLAUDE_CHANNEL_TARGET
unique workspace match
exactly one live endpoint
error
```

This mirrors Docker's flag/env/config structure without adopting Docker's exact names.

### Terraform CLI

Sources:

- <https://developer.hashicorp.com/terraform/cli/commands/init>
- <https://docs.hashicorp.com/terraform/cli/commands/state>
- <https://developer.hashicorp.com/terraform/internals/machine-readable-ui>

Patterns to adopt:

- Machine-readable output is explicit (`-json`).
- Color and interactive behavior are controllable.
- Long-running operations expose timeout/lock controls rather than hanging silently.
- State mutation commands are cautious and explicit.

Implications for `claude-cli-channel`:

- `ask` should expose `--timeout`.
- Mutating user defaults should be explicit (`use`, `label`, `unuse`), not a side effect of `ask`.
- Avoid surprise interactivity in agent-facing commands.

### XDG Base Directory Spec

Source:

- <https://specifications.freedesktop.org/basedir-spec/0.8/>

Patterns to adopt:

- Separate config, state, cache, and runtime files.
- Treat runtime files as ephemeral and local to the machine/session.
- Require absolute override paths.

Implications for `claude-cli-channel`:

For the first macOS-focused iteration, `~/.claude-channel` is acceptable and easy to inspect. Before packaging broadly, move toward platform-aware directories:

```text
config:  current target, labels, user preferences
state:   endpoint records, last-seen metadata
runtime: sockets or pid files if a daemon/socket appears later
cache:   nonessential derived data
```

Do not put durable message history in runtime state. If durable history ever appears, it is a product feature and should have an explicit retention/privacy design.

### File Locking

Source:

- <https://www.npmjs.com/package/proper-lockfile>

Patterns to adopt:

- Use atomic lock acquisition for shared files touched by multiple processes.
- Treat stale locks explicitly.
- Keep lock scope small and wrap only the read-modify-write section.

Implications for `claude-cli-channel`:

Endpoint records are written one file per process, so current live-endpoint registration does not need read-modify-write locking. Future shared config writes for labels or persistent current-target settings should be guarded by a small filesystem lock instead of relying on last-write-wins JSON writes.

## Architecture Principles

### 1. Separate Core From Interfaces

Recommended layers:

```text
protocol/
  request ids, message types, validation, metadata rules

registry/
  endpoint records, liveness checks, stale pruning

channel-client/
  target resolution and HTTP calls

channel/
  Claude Code MCP server and reply tool

http/
  local ingress for CLI/Codex MCP clients

cli/
  command definitions and output formatting only

codex-mcp/
  MCP tool definitions that call the shared client
```

No CLI command should directly parse endpoint files or construct channel payloads.
No MCP tool should own target resolution independently from the CLI.
The Claude channel process should not know about human table formatting, command flags, or Codex-specific tool schemas.

### 2. Use File-Backed Endpoint Records Before a Daemon

For a same-host, live-session-only channel, a daemon is not the default. A daemon is justified only when:

- routing must survive all Claude channel processes exiting
- requests must outlive the sending process
- multiple transports need fanout
- durable history/mailbox semantics are introduced

Until then, endpoint JSON files plus health checks are simpler and more debuggable.

### 3. Treat Current Target as a Context

Use Docker/kubectl-style semantics when persistent targeting lands:

```text
list     shows all known live endpoints
use      sets persistent current target
current  prints current target
--to     overrides current target for one command
env var  overrides current target for one shell/session
```

Today's implemented precedence is `--to`, `CLAUDE_CHANNEL_TARGET`, unique workspace match, exactly one endpoint, then error. Do not infer current target from branch, terminal title, task name, or transcript name.

Identity vocabulary:

```text
endpoint  live channel process spawned inside one Claude Code session
endpoint_id stable id for that endpoint record
label     optional human alias owned by claude-channel
current   persisted default target
target    user-supplied selector that resolves to exactly one live endpoint
```

Avoid calling these "sessions" in low-level code unless Claude Code exposes a real session UUID through a supported API. The CLI can display "sessions" in UX copy, but the routing primitive is an endpoint.

### 4. Make Output Contracts Stable

Human output can evolve. JSON output is an API.

Version JSON shapes defensively:

```json
{
  "schema_version": 1,
  "endpoints": []
}
```

This matters because Codex and shell scripts will consume it.

### 5. Prefer Explicit Errors Over Recovery Magic

Bad:

```text
Claude forgot request_id, so route reply to oldest pending request.
```

Good:

```text
unknown_request_id
missing_request_id
multiple_targets
target_offline
ask_timeout
```

This is less magical and easier to debug.

### 6. Keep Secrets Out of Environment Defaults

Use a token file with `0600` permissions by default.

Environment variables are acceptable for non-secret overrides like target, host, port, and timeout. They should not be the preferred secret storage mechanism.

### 7. Keep the Product Synchronous Until Proven Otherwise

The core value is native harness collaboration:

```text
Codex asks -> Claude Code sees it in the real window -> Claude replies through a tool -> Codex receives the answer
```

Do not introduce inboxes, team routing, durable queues, wakeups, or role assignment in the core. Those are different products.

### 8. Make Ambiguity a First-Class Error

Ambiguity cases should be designed, not patched over:

```text
no_live_targets
multiple_live_targets
unknown_target
target_offline
current_target_offline
duplicate_label
ask_timeout
missing_request_id
unknown_request_id
```

These errors should have stable codes in JSON and concise next steps in human output.

## Recommended Command Shape

Implemented now:

```sh
claude-channel list [--json]
claude-channel status [--to <target>]
claude-channel tell [--to <target>] <message...>
claude-channel ask [--to <target>] [--timeout <duration>] [--output text|json] <message...>
claude-channel tell-file [--to <target>] <file|->
claude-channel ask-file [--to <target>] [--timeout <duration>] [--output text|json] <file|->
```

Future user-owned targeting config:

```sh
claude-channel current [--json]
claude-channel use <target>
claude-channel unuse
claude-channel label <target> <label>
claude-channel unlabel <target-or-label>
claude-channel prune
claude-channel doctor
```

Aliases:

```sh
claude-channel send      -> claude-channel tell
claude-channel send-file -> claude-channel tell-file
```

Avoid adding a generic `message` command. `tell` and `ask` are clearer because they encode whether Codex expects a returned answer.

## Recommended Persistence Shape

Use snake_case for persisted and HTTP JSON. Keep TypeScript internals idiomatic with camelCase at module boundaries if desired, but convert at the API edge.

```text
~/.claude-channel/
  token
  config.json
  endpoints/
    ep_<id>.json
  logs/
```

`config.json`:

```json
{
  "schema_version": 1,
  "current_target": "main",
  "labels": {
    "main": "ep_abc123"
  }
}
```

Endpoint record:

```json
{
  "schema_version": 1,
  "endpoint_id": "ep_abc123",
  "host": "127.0.0.1",
  "port": 49152,
  "pid": 12345,
  "project_dir": "/path/to/example",
  "started_at": "2026-05-18T00:00:00.000Z",
  "last_seen_at": "2026-05-18T00:00:05.000Z"
}
```

Labels belong in config, not endpoint records. A label is user-owned local naming, while an endpoint record is process-owned liveness metadata.

## Recommended Next Implementation Order

Completed foundation:

1. Endpoint registry with dynamic ports and liveness checks.
2. Target resolution in `channel-client`.
3. CLI `list` plus `--to` targeting.
4. `list_claude_targets` in the Codex MCP server.
5. Tests for stale endpoint pruning and ambiguous target resolution.

Recommended next order:

1. Add user-owned labels only after real usage shows repeated target selection friction.
2. Add persistent `current`, `use`, and `unuse` with file locking when labels/config are introduced.
3. Add `prune` and `doctor` for supportability.
4. Add registry/config locking tests when shared config writes exist.

Do not add a daemon until the file-backed registry fails a concrete requirement.
