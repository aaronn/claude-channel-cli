# Protocol

`claude-cli-channel` uses Claude Code Channels for inbound messages and an MCP tool for replies.

Codex-facing MCP tools are adapters over the same local HTTP bridge:

- `list_claude_targets`
- `status_claude_channel`
- `tell_claude`
- `ask_claude`

The shell CLI is another adapter over that same bridge.

## Targets

Each channel-enabled Claude Code process writes a live endpoint record under:

```text
~/.claude-channel/endpoints/ep_<id>.json
```

Codex and CLI callers resolve a target before making HTTP calls. Resolution order is:

```text
explicit target argument / --to
CLAUDE_CHANNEL_TARGET
unique workspace match
exactly one live endpoint
error
```

An explicit target may be an endpoint id, unique display name, project path, or numeric index from the current list output. Endpoint ids are the durable protocol-facing selector.

Codex MCP list call:

```json
{
  "tool": "list_claude_targets",
  "arguments": {}
}
```

Result:

```json
{
  "targets": [
    {
      "index": 1,
      "target": "ep_ABC234",
      "endpoint_id": "ep_ABC234",
      "display_name": "example",
      "project_dir": "/path/to/example",
      "host": "127.0.0.1",
      "port": 49152,
      "pid": 12345,
      "started_at": "2026-05-18T00:00:00.000Z",
      "last_seen_at": "2026-05-18T00:00:05.000Z",
      "last_seen_seconds": 5
    }
  ]
}
```

## Tell

Codex MCP:

```json
{
  "tool": "tell_claude",
  "arguments": {
    "target": "ep_ABC234",
    "message": "From Codex: hello"
  }
}
```

HTTP:

```http
POST /tell
Authorization: Bearer <token>
Content-Type: text/plain

From Codex: hello
```

Channel notification:

```json
{
  "method": "notifications/claude/channel",
  "params": {
    "content": "From Codex: hello",
    "meta": {
      "sender": "codex",
      "reply_required": "false",
      "received_at": "..."
    }
  }
}
```

Adapter response:

```json
{
  "ok": true,
  "target": "ep_ABC234"
}
```

## Status

Codex MCP:

```json
{
  "tool": "status_claude_channel",
  "arguments": {
    "target": "ep_ABC234"
  }
}
```

Result:

```json
{
  "target": "ep_ABC234",
  "reachable": true,
  "endpoint": {
    "endpoint_id": "ep_ABC234"
  },
  "health": {
    "ok": true
  }
}
```

## Ask

Codex MCP:

```json
{
  "tool": "ask_claude",
  "arguments": {
    "target": "ep_ABC234",
    "message": "From Codex: please review this.",
    "timeout_ms": 1800000
  }
}
```

HTTP:

```http
POST /ask?timeout_ms=1800000
Authorization: Bearer <token>
Content-Type: text/plain

From Codex: please review this.
```

Channel notification:

```json
{
  "method": "notifications/claude/channel",
  "params": {
    "content": "From Codex: please review this.",
    "meta": {
      "sender": "codex",
      "request_id": "req_...",
      "reply_required": "true",
      "received_at": "..."
    }
  }
}
```

Claude Code completes the request by calling:

```json
{
  "request_id": "req_...",
  "status": "answered",
  "answer": "..."
}
```

Valid statuses:

- `answered`
- `needs_user`
- `declined`
- `failed`

HTTP response:

```json
{
  "ok": true,
  "target": "ep_ABC234",
  "request_id": "req_...",
  "status": "answered",
  "answer": "..."
}
```

The raw local HTTP bridge does not require a target field in the body because target resolution happens in the CLI or Codex MCP adapter before the request is sent. Adapter responses include `target` so callers can audit which Claude Code endpoint was used.

## Target Errors

When no unambiguous target can be resolved, Codex MCP tools return structured errors:

```json
{
  "ok": false,
  "error": "multiple_claude_targets",
  "message": "Multiple Claude Code channel endpoints are running. Specify a target.",
  "candidates": []
}
```

Stable target error codes:

- `no_claude_targets`
- `unknown_claude_target`
- `multiple_claude_targets`

## Metadata

Claude Code Channel metadata keys must be simple strings. `claude-cli-channel` only emits keys matching:

```text
^[A-Za-z0-9_]+$
```
