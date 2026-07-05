---
name: claude-channel-cli
description: Use when Codex needs to ask a user's live Claude Code session for a response through the local Claude Channel CLI or check whether the channel is reachable without using API-mode Claude access.
---

# Claude Channel CLI

Use the bundled Claude Channel CLI MCP tools to communicate with the user's live Claude Code session. This preserves Claude Code's native harness and lets the user monitor the same session in their Claude Code window.

## Workflow

1. List available Claude targets with `list_claude_targets`. If there is one target, use it. If there are several, show the numbered candidates and ask which visible Claude Code window to use.
2. Check the selected target with `status_claude_channel`, passing `target` when one was selected.
3. Use `ask_claude`, passing `target` when needed.
4. For review-sized, complex, or high-effort Claude Code asks, expect replies to take several minutes and sometimes close to the 30-minute default timeout. Do not treat a quiet Claude Code session as failed before the configured timeout. Ask the user before using a longer timeout.
5. If a tool returns `multiple_claude_targets`, ask the user to choose from `candidates`, then retry with that candidate's `endpoint_id`.
6. If the MCP tools are unavailable in a development checkout, fall back to the `claude-channel` CLI.

## Rules

- Do not use this skill for normal web/API Claude access. It is only for a local live Claude Code session.
- Use `ask_claude` for every Claude Code request. The channel sender receives a response only through the reply-required completion path.
- Keep Claude-facing prompts separate from Codex handling instructions. Send Claude only what Claude should answer.
- If the user says "verbatim", "exactly", "send this block", or gives a fenced/quoted prompt, send only that exact block as `message`. Preserve wording, ordering, and whitespace.
- For long or multiline exact prompts, pass the block directly as MCP `message`. In CLI fallback, stream only that block to `ask-file -`; never include Codex-only handling instructions in file/stdin payloads.
- When content comes from another tool or plugin, summarize it only if the user asked for a summary. If the user asks to send it exactly, pass the selected text exactly.
- Keep messages explicit about their source, e.g. start with `From Codex:`.
- After `ask_claude` returns, use the structured `answer` field. If `answer_truncated` is true, read the full response from `answer_file` before acting on it. Do not dump raw JSON unless debugging.
- CLI fallback `ask` and `ask-file` print Claude's answer text by default. Use `--output json` only when the full response envelope is needed.
- For very large CLI fallback reviews, redirect answer text to a visible file instead of relying on terminal output capture.
- When multiple live targets exist, ask the user to choose from `candidates`; never guess from branch names, task names, terminal titles, or transcript names.
- Prefer endpoint ids for retries and scripts. Numeric list indexes are acceptable only for immediate human CLI fallback.
- If `status_claude_channel` reports the channel is not reachable, tell the user the channel is not running and ask them to start Claude Code in the receiver project with `claude-channel start`. `claude-channel setup` is only a readiness and stale-registration check.

## CLI Fallback

Use this only when the Codex MCP tools are not installed or not available in the current thread:

```sh
claude-channel list
claude-channel status
claude-channel setup
claude-channel start
claude-channel ask --to ep_ABC234 "From Codex: review this plan and return your answer with complete_channel_request."
printf '%s\n' "$prompt" | claude-channel ask-file --to ep_ABC234 -
printf '%s\n' "$prompt" | claude-channel ask-file --output json --to ep_ABC234 - > claude-review.json
```
