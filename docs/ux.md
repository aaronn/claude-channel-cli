# UX

The product goal is simple:

```text
Send this to that visible Claude Code thread, and optionally wait for its answer.
```

## Primary Commands

```sh
claude-channel tell "FYI from Codex..."
claude-channel ask "Please review this plan and answer Codex."
claude-channel tell-file -
claude-channel ask-file -
claude-channel status
```

`send` remains an alias for `tell`. `send-file` remains an alias for `tell-file`.

## Human Model

`tell` is fire-and-forget. The user watches Claude Code handle the message in its normal terminal.

`ask` waits for Claude Code to explicitly complete the request. Claude should call `complete_channel_request` once it has the final answer. The CLI prints wait progress to stderr and leaves stdout for the final machine-readable response.

`ask` defaults to 30 minutes because review-sized work can be slow. The timeout is still explicit and configurable with `--timeout`, `--timeout-ms`, or `CLAUDE_CHANNEL_ASK_TIMEOUT_MS`.

## Prompt Input

Short prompts should be sent inline:

```sh
claude-channel ask "From Codex: review the current plan and return the answer with complete_channel_request."
```

Generated multiline prompts should use stdin:

```sh
printf '%s\n' "$prompt" | claude-channel ask-file -
```

Reusable prompt files are optional user/project assets:

```sh
claude-channel ask-file prompts/review.md
```

This avoids requiring pre-created prompt files for normal usage while keeping files available for stable review rubrics.

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

When multiple live channel endpoints exist, future versions should require an explicit target:

```sh
claude-channel list
claude-channel ask --to ep_abc123 "..."
claude-channel label ep_abc123 main
claude-channel use ep_abc123
```

If exactly one endpoint exists, `--to` can be optional. If multiple endpoints exist and no default target has been set, the command should fail with a clear prompt to run `claude-channel list`.

Target selection precedence:

```text
--to
CLAUDE_CHANNEL_TARGET
configured current target
exactly one live endpoint
error
```

Do not infer target from repo, branch, terminal title, cwd, or Claude Code transcript names.

## Multiple Windows

`claude-channel list` should show live channel endpoints with enough context for a human to choose:

```text
CURRENT  TARGET     STATUS  PROJECT                         PID    AGE
*        main       live    /path/to/app          12345  12m
         ep_def456  live    /path/to/claude-cli-channel    12399  3m
```

Labels are user-owned aliases:

```sh
claude-channel label ep_def456 channel
claude-channel use channel
claude-channel ask --to main "..."
```

This keeps the UX flexible for users who keep one long-lived Claude Code thread per repo, one per task, one per branch, or any other workflow.

## Non-Goals

- no mailbox UX
- no team/role routing
- no hidden branch-based routing
- no terminal scraping as the primary path
- no transcript-file mutation
- no synchronous API-mode Claude call
