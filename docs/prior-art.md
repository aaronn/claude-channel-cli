# Prior Art Research

This document captures agent-bridge domain research behind `claude-cli-channel`. These projects are useful for understanding Claude/Codex constraints, but they should not be treated as primary architecture references. For broader CLI/DX and persistence patterns, see [software-patterns.md](software-patterns.md).

## Official Contracts

### Claude Code Channels

Source: <https://code.claude.com/docs/en/channels> and <https://code.claude.com/docs/en/channels-reference>

Relevant facts:

- A channel is an MCP server loaded by Claude Code.
- It pushes events into the running Claude Code session with `notifications/claude/channel`.
- Events arrive only while the session is open.
- Channel notifications are not acknowledged; `mcp.notification()` only confirms the JSON-RPC notification was written to the transport.
- Two-way channels use an ordinary MCP reply tool. Claude calls that tool to send a response back to the external platform.
- Channel metadata becomes attributes on the `<channel>` tag. Metadata keys must be simple identifiers: letters, digits, and underscores only.
- Sender allowlists are the security pattern for official channel plugins.
- Permission relay is separate, sensitive, and should only be enabled for authenticated senders.

Design implication:

`claude-channel ask` must use an explicit reply/completion tool. Inferring "the next Claude answer" is not part of the channel contract.

### MCP

Source: <https://modelcontextprotocol.io/specification/2025-06-18/basic/index>, <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>, and <https://modelcontextprotocol.io/specification/2025-06-18/client/roots>

Relevant facts:

- MCP messages are JSON-RPC.
- Notifications are one-way and must not receive responses.
- Stdio and Streamable HTTP are the standard transports.
- Stdio servers must keep stdout reserved for JSON-RPC; diagnostics belong on stderr.
- Roots are a standard way for clients to expose workspace/project directories, but the protocol does not prescribe a UX model.
- HTTP MCP has an auth framework; stdio servers generally receive credentials through environment/config.

Design implication:

Keep the Claude-side channel server on stdio. Keep local HTTP as an app-specific ingress, not as an MCP transport. Do not write logs to stdout from the channel process.

## Existing Projects

### AgentBridge

Source: <https://github.com/raysonmeng/agent-bridge>

Pattern:

- Two-process architecture.
- Foreground MCP client is spawned by Claude Code.
- Background daemon owns Codex app-server proxy and bridge state.
- Uses Codex app-server protocol and forwards messages both ways.
- Has plugin marketplace packaging and CLI wrappers.
- Uses platform-aware state directories.

Useful ideas:

- Good separation between foreground channel process and long-lived daemon.
- Clear CLI wrapper commands and plugin packaging story.
- Explicit state directory with pid/status/log files.
- Strong loop-prevention concept using message `source`.

Mismatch for `claude-cli-channel`:

- Larger harness than desired.
- Requires owning Codex launch mode.
- Current limitations include single Codex thread, single Claude foreground connection, and fixed ports.
- Introduces daemon complexity before we know it is needed.

Takeaway:

Do not start with an AgentBridge-style daemon. Revisit only if multiple Codex clients or long-lived background routing become necessary.

### codex-claude-bridge

Source: <https://github.com/abhishekgahlot2/codex-claude-bridge>

Pattern:

- Claude-side channel server exposes HTTP endpoints.
- Codex-side MCP tool `send_to_claude` posts to the bridge and long-polls for the reply.
- Claude replies through a `reply` tool with a correlation id.
- Includes a web UI and human observer path.

Useful ideas:

- Codex-initiated blocking request maps well to Codex's MCP tool model.
- Correlating replies by `message_id`/`reply_to` is the right shape.
- Long-poll slices avoid hidden client/server timeout cliffs.
- Deduping in-flight identical messages avoids accidental duplicate sends.

Mismatch for `claude-cli-channel`:

- Fixed port.
- Single file server with mixed UI, HTTP API, MCP server, and state.
- Web UI is not part of our target UX.
- Reply routing has a fallback to "oldest pending" if Claude omits `reply_to`; that is convenient but ambiguous.

Takeaway:

Keep the request/reply correlation idea. Avoid fallback routing and keep modules separate.

### claude-relay

Source: <https://github.com/EcoConsulting/claude-relay>

Pattern:

- One channel process per Claude Code session.
- One detached hub daemon per machine.
- Unix socket between channel processes and hub.
- Peers register by name, can rename, list peers, ask, reply, and broadcast.
- Wire protocol has explicit message types and error codes.
- Strong ubiquitous language document.
- Extensive socket-level tests.

Useful ideas:

- Strong separation of protocol, framing, hub registry, pending asks, channel routing, and MCP tool definitions.
- Names are user-facing labels, not hidden workflow assumptions.
- `ask_id`/`thread_id` vocabulary is clear and testable.
- Stale socket detection and zombie peer eviction are practical.
- Explicit error codes make agent and human UX better.

Mismatch for `claude-cli-channel`:

- Claude-to-Claude only.
- `relay_ask` is intentionally async; replies arrive later as channel notifications.
- Hub daemon is justified for N-to-N peer routing, but may be too much for one Codex-to-Claude bridge.

Takeaway:

Borrow terminology, error-code discipline, and test style. Do not borrow async semantics.

### cross-agent-teams-mcp

Source: <https://github.com/jtianling/cross-agent-teams-mcp> and <https://jtianling.com/en/cross-agent-teams-release.html>

Pattern:

- Local MCP daemon with SQLite mailbox.
- Agents register identity and delivery capabilities.
- Claude Code delivery uses a channel proxy.
- Codex delivery can use Codex app-server WebSocket or tmux fallback.
- Supports names, teams, roles, inboxes, broadcasts, and wakeups.

Useful ideas:

- Correctly distinguishes a channel proxy session from the owner Claude session.
- Uses `ui_pid` to bind Claude Code's MCP session to the matching channel proxy.
- Dispatch layer chooses the best available transport per target.
- Documents that external HTTP registration creates a different MCP session and should not be treated as registering the live Claude session.

Mismatch for `claude-cli-channel`:

- Mailbox/inbox model is explicitly async.
- Teams/roles/broadcasts add product surface area we do not want.
- SQLite persistence is appropriate for mailboxes, but excessive for ephemeral request/reply routing.

Takeaway:

Keep the session-boundary lesson. Avoid mailbox persistence and routing roles.

## Design Synthesis

### Product Boundary

`claude-cli-channel` should address live channel-enabled Claude Code sessions only.

It should not:

- discover arbitrary Claude Code terminals
- write Claude transcript files
- simulate typing through tmux as the primary transport
- create a mailbox/inbox system
- own Codex or Claude launch mode unless explicitly asked

### Runtime Model

Initial model:

```text
Codex/shell
  -> claude-channel CLI or Codex MCP tool
  -> local HTTP ingress owned by Claude-side channel process
  -> notifications/claude/channel
  -> Claude Code live session
  -> complete_channel_request tool
  -> pending request resolves
```

This keeps the implementation small while preserving the native harnesses.

### Persistence Model

Use local filesystem JSON for v0:

```text
~/.claude-channel/
  token
  config.json
  endpoints/
    ep_<id>.json
```

Do not use SQLite until we need durable message history or mailbox semantics.

Endpoint records should be ephemeral and describe channel processes:

```json
{
  "schema_version": 1,
  "endpoint_id": "ep_...",
  "host": "127.0.0.1",
  "port": 49152,
  "pid": 12345,
  "project_dir": "/absolute/path/if-known",
  "started_at": "...",
  "last_seen_at": "..."
}
```

`project_dir` is display metadata, not identity. User labels and the current target belong in config because they are user-owned routing preferences, not process-owned endpoint state.

### Identity and Targeting

Keep identities distinct:

- `endpoint_id`: routing identity for a live endpoint.
- `label`: optional user alias.
- `project_dir`: display hint.
- Claude transcript/session id: optional metadata only if Claude exposes it reliably.

Target resolution should be:

```text
explicit --to
  > CLAUDE_CHANNEL_TARGET
  > unique workspace match
  > exactly one live endpoint
  > fail with guidance
```

Never infer a target from branch name, task name, terminal title, or transcript name.

### Sync Ask Semantics

For `ask`, use strict request correlation:

- create `request_id`
- include `reply_required=true`
- Claude must call `complete_channel_request({ request_id, status, answer })`
- no fallback to "oldest pending"
- timeout produces an explicit error

Supported completion statuses:

- `answered`
- `needs_user`
- `declined`
- `failed`

### CLI UX

Human-first commands:

```sh
claude-channel list
claude-channel tell --to ep_ABC234 "..."
claude-channel ask --to ep_ABC234 "..."
claude-channel ask-file --to ep_ABC234 -
```

Labels, persistent `use`/`current`, `prune`, and `doctor` remain future supportability work.

Machine-friendly output:

- human-readable by default
- `--json` or `--format json` for scripts and agents
- errors on stderr with actionable next steps
- non-zero exit on failure

### Codex MCP UX

Codex should call MCP tools rather than shell out when the Codex plugin is installed:

```text
status_claude_channel() -> status
tell_claude(target?, message) -> delivered
ask_claude(target?, message, timeout_ms?) -> answer
list_claude_targets() -> endpoints
```

The MCP server should use the same client and target-resolution modules as the CLI.

### Security

Defaults:

- bind to `127.0.0.1`
- bearer token in a `0600` file
- request body size cap
- no unauthenticated sends
- no permission relay in v0
- no public listener in v0
- logs to stderr or local log file, never stdout from stdio MCP server

Future permission relay requires a separate threat model because it lets remote senders approve or deny Claude Code tool use.

### Testing Strategy

Copy claude-relay's bias toward integration-style tests around real protocol behavior.

First tests:

- metadata sanitizer drops invalid keys
- pending request completes once
- timeout removes pending request
- unknown completion id returns a clear tool result
- HTTP `/ask` returns 504 on timeout
- endpoint registry lists live endpoints
- target resolver fails on ambiguity
- stale endpoint prune removes dead records

## Open Questions

- Can Claude Code expose the active session UUID to channel servers? If not, do not infer it.
- Should endpoint files live under `~/.claude-channel` or platform-aware state dirs (`~/Library/Application Support` on macOS, `$XDG_STATE_HOME` on Linux)?
- Should `tell` and `ask` remain CLI verbs, or should `send` alias only `tell` for compatibility?
- Should the Codex MCP server be bundled in the same npm package or published as a second binary?

## Architecture Direction

The project now has the intended foundation: one lightweight Claude-side channel process per Claude Code window, file-backed endpoint records, shared target resolution, and no daemon.

Implemented:

1. Endpoint registry with dynamic ports.
2. `list` and `--to`.
3. Multi-target support in the shared `channel-client` layer.
4. Tests around protocol, registry, and resolver.
5. Codex MCP server exposes `list_claude_targets`.

Next milestone:

1. User-owned labels if endpoint ids become too high-friction.
2. Persistent `use` / `current` config with locking.
3. `prune` and `doctor` support commands.

Defer:

- background daemon
- SQLite
- web UI
- permission relay
- tmux fallback
- cross-machine routing
