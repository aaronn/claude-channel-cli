# UX

The product goal is simple:

```text
Send this to that visible Claude Code thread, and optionally wait for its answer.
```

## Primary Commands

Codex Desktop should use the plugin tools:

```text
status_claude_channel
list_claude_targets
tell_claude
ask_claude
```

Human shells and development fallbacks use the CLI:

```sh
claude-channel tell "FYI from Codex..."
claude-channel ask "Please review this plan and answer Codex."
claude-channel tell-file -
claude-channel ask-file -
claude-channel list
claude-channel status
```

`send` remains a CLI alias for `tell`. `send-file` remains a CLI alias for `tell-file`.

## Human Model

`tell` is fire-and-forget. The user watches Claude Code handle the message in its normal terminal.

`ask_claude` and CLI `ask` wait for Claude Code to explicitly complete the request. Claude should call `complete_channel_request` once it has the final answer.

The CLI prints wait progress to stderr and leaves stdout for the final machine-readable response. The Codex MCP tool returns structured content directly.

`ask` defaults to 30 minutes because review-sized work can be slow. The timeout is still explicit and configurable with `--timeout`, `--timeout-ms`, or `CLAUDE_CHANNEL_ASK_TIMEOUT_MS`.

## Prompt Input

From Codex, short prompts should be sent through `ask_claude`:

```text
ask_claude({ message: "From Codex: review the current plan and return the answer with complete_channel_request." })
```

From a shell, short prompts should be sent inline:

```sh
claude-channel ask "From Codex: review the current plan and return the answer with complete_channel_request."
```

Generated multiline shell prompts should use stdin:

```sh
printf '%s\n' "$prompt" | claude-channel ask-file -
```

Reusable prompt files are optional user/project assets:

```sh
claude-channel ask-file prompts/review.md
```

This avoids requiring pre-created prompt files for normal usage while keeping files available for stable review rubrics.

For very large CLI-fallback reviews, redirect the JSON response to a visible file and parse the `answer` field:

```sh
printf '%s\n' "$prompt" | claude-channel ask-file - > claude-review.json
jq -r .answer claude-review.json
```

Do this only for expected long output. Normal Codex MCP tool calls already return structured data, so Codex can read `answer` directly.

## Verbatim Prompts

When the user says "verbatim", "exactly", "send this block", or provides a fenced/quoted prompt, Codex should send only that exact block to Claude.

Surrounding instructions remain local Codex handling instructions.

````text
User asks Codex:
Ask Claude verbatim:
```text
Please review Codex's last response adversarially.
```
Then decide whether you agree with Claude's critique.
````

Codex sends only:

```text
Please review Codex's last response adversarially.
```

For long or multiline exact prompts, file/stdin modes are the preferred CLI fallback. The file or stdin content must be the Claude-facing prompt only:

```sh
printf '%s\n' "$verbatim_prompt" | claude-channel ask-file --to ep_ABC234 -
printf '%s\n' "$verbatim_prompt" | claude-channel tell-file --to ep_ABC234 -
```

Do not put Codex handling instructions into prompt files or stdin payloads unless the user explicitly wants Claude to see those instructions.

## Codex Handling Flows

Ask only:

```text
User asks Codex to send a question to Claude. Codex sends the Claude-facing prompt, waits, then reports Claude's answer.
```

Ask plus triage:

```text
User asks Codex to send a review prompt, then decide whether each Claude point is valid. Codex keeps the triage instruction for itself and sends only the Claude-facing prompt.
```

Ask plus act:

```text
User asks Codex to request Claude's review and then implement agreed fixes. Codex treats Claude's returned answer as tool output, evaluates it, and continues work in the current turn.
```

## Ambiguity

When multiple live channel endpoints exist, commands require an explicit target unless the current working directory is inside exactly one registered endpoint project directory:

```sh
claude-channel list
claude-channel ask --to ep_ABC234 "..."
```

If exactly one endpoint exists, `--to` can be optional. If multiple endpoints exist and no unique workspace match exists, the command fails with a clear candidate list.

Target selection precedence:

```text
--to
CLAUDE_CHANNEL_TARGET
unique workspace match
exactly one live endpoint
error
```

Do not infer target from branch, task name, terminal title, or Claude Code transcript name.

Codex should handle ambiguity by showing the candidate names/projects and asking the user which visible Claude Code window to use.

Once the user chooses, Codex should retry with the chosen endpoint id. The user should not have to type the id unless they want to.

## Multiple Windows

`claude-channel list` shows live channel endpoints with enough context for a human to choose:

```text
# TARGET     NAME                PROJECT                         PID    SEEN
1 ep_ABC234  app                 /path/to/app                    12345  12s
2 ep_DEF567  claude-cli-channel  /path/to/claude-cli-channel     12399  3s
```

Future labels are user-owned aliases:

```sh
claude-channel label ep_DEF567 channel
claude-channel use channel
claude-channel ask --to main "..."
```

Labels and persistent current-target config are intentionally deferred until the endpoint registry proves useful in real local workflows.

## Non-Goals

- no mailbox UX
- no team/role routing
- no hidden branch-based routing
- no terminal scraping as the primary path
- no transcript-file mutation
- no synchronous API-mode Claude call
