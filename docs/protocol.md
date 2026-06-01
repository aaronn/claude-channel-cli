# Protocol

`claude-cli-channel` uses Claude Code Channels for inbound messages and an MCP tool for replies.

## Tell

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

## Ask

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
  "request_id": "req_...",
  "status": "answered",
  "answer": "..."
}
```

## Metadata

Claude Code Channel metadata keys must be simple strings. `claude-cli-channel` only emits keys matching:

```text
^[A-Za-z0-9_]+$
```
