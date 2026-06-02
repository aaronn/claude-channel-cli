# Architecture

`claude-cli-channel` is a thin request/reply channel between native Codex and native Claude Code.

It is intentionally not a multi-agent mailbox, terminal scraper, transcript editor, or custom chat harness.

## Boundary

The addressable unit is a live, channel-enabled Claude Code session.

`claude-cli-channel` can communicate with a Claude Code window only when that window has loaded the `claude-cli-channel` MCP/channel server.

It does not discover arbitrary Claude Code terminals and does not inject into old transcript files.

## Components

```text
Codex / shell
  calls Codex MCP tools or claude-channel CLI fallback

Codex MCP server
  exposes list_claude_targets, status_claude_channel, tell_claude, ask_claude
  uses the shared channel-client layer

Endpoint registry
  stores live endpoint records under ~/.claude-channel/endpoints/
  prunes stale or dead process records during listing/resolution

Target resolver
  selects exactly one endpoint from --to, CLAUDE_CHANNEL_TARGET,
  a unique workspace match, or a singleton live endpoint

Local HTTP ingress
  authenticates localhost requests
  validates request bodies
  creates request ids for ask flows

Claude channel MCP server
  is spawned by Claude Code
  emits notifications/claude/channel
  exposes complete_channel_request

Pending request registry
  correlates request_id -> waiting Codex/shell caller
```

## Modes

`tell` is one-way:

```text
caller -> POST /tell -> channel notification -> Claude Code window
```

`ask` is synchronous:

```text
caller -> POST /ask -> channel notification with request_id
Claude Code -> complete_channel_request(request_id, answer)
pending request resolves -> caller receives answer
```

The reply tool is part of the protocol because Claude Code Channels do not stream ordinary assistant messages back to the channel server.

## Multiple Claude Code Windows

Each channel-enabled Claude Code window registers a live endpoint record:

```text
~/.claude-channel/endpoints/ep_<id>.json
```

Endpoint records should describe channel instances, not user workflow assumptions:

```json
{
  "schema_version": 1,
  "endpoint_id": "ep_...",
  "host": "127.0.0.1",
  "port": 49152,
  "pid": 12345,
  "project_dir": "/absolute/path/if-known",
  "display_name": "project-name",
  "started_at": "2026-05-18T00:00:00.000Z",
  "last_seen_at": "2026-05-18T00:00:05.000Z"
}
```

Repo names, branches, and task names may be display hints, but must not be routing identity.

User-facing labels should live in future config, not endpoint records. A label is a local alias selected by the user; an endpoint record is process-owned liveness data.

Target resolution should be explicit:

```text
--to
CLAUDE_CHANNEL_TARGET
unique workspace match
exactly one live endpoint
error
```

This matches mature CLI context patterns while avoiding hidden routing by branch, task, terminal title, or transcript name.

The workspace match is intentionally conservative: it applies only when the caller's current working directory is inside exactly one live endpoint's registered project directory.

## Module Boundaries

The intended architecture is layered:

```text
protocol    request ids, payload validation, metadata rules
registry    endpoint records, liveness checks, stale pruning
channel-client
            target resolution, token auth, timeout parsing, HTTP calls
channel     Claude Code MCP channel server and completion tool
http        local authenticated ingress
cli         command parsing and output formatting
codex-mcp   Codex-facing tools built on the shared client
```

The current implementation has endpoint records, stale pruning, and target resolution. Labels and persistent current-target config remain future `registry`/config work.

The CLI and Codex MCP server share the same client and resolver modules. Neither should recreate HTTP payload construction or target resolution.

## Security

Defaults should remain conservative:

- bind to `127.0.0.1`
- require a bearer token
- store token files with mode `0600`
- cap request body size
- keep MCP stdout clean for JSON-RPC
- write diagnostics to stderr

Permission relays and remote listeners are separate features and should be explicit opt-ins.
