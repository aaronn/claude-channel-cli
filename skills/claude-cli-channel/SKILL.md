---
name: claude-cli-channel
description: Use when Codex needs to send a coordination message into a user's live Claude Code session through the local claude-cli-channel channel, check whether the channel is reachable, or send a prompt to Claude Code without using API-mode Claude access.
---

# Claude CLI Channel

Use the bundled `claude-cli-channel` MCP tools to communicate with the user's live Claude Code session. This preserves Claude Code's native harness and lets the user monitor the same session in their Claude Code window.

## Workflow

1. List available Claude targets with `list_claude_targets`. If there is exactly one target, use it. If there are multiple targets and the user has not already identified the right one, present the numbered candidates and ask which visible Claude Code window to use.
2. Check the selected target with `status_claude_channel`, passing `target` when one was selected.
3. For one-way messages, use `tell_claude`, passing `target` when needed.
4. For requests that need a response in Codex, use `ask_claude`, passing `target` when needed.
5. For review-sized asks, rely on the 30-minute default timeout unless the user asks for a different timeout.
6. If a tool returns `multiple_claude_targets`, use its `candidates` list to ask the user to choose by visible project/name. Retry with the chosen candidate's `endpoint_id`; do not make the user type the endpoint id unless they prefer that.
7. If the MCP tools are unavailable in a development checkout, fall back to the `claude-channel` CLI.

## Rules

- Do not use this skill for normal web/API Claude access. It is only for a local live Claude Code session.
- Use `tell_claude` only when no response is needed. Use `ask_claude` when Codex needs Claude Code's answer.
- Keep Claude-facing prompts separate from Codex handling instructions. Send Claude only what Claude should answer; keep instructions like "then decide whether you agree" for Codex after the tool output returns.
- Keep messages explicit about their source, e.g. start with `From Codex:`.
- After `ask_claude` returns, use the structured `answer` field. Do not dump raw JSON unless debugging.
- When multiple live targets exist, fail closed and ask the user to choose from `candidates`; never guess based on branch names, task names, terminal titles, or transcript names.
- Prefer endpoint ids for retries and scripts. Numeric list indexes are acceptable only for immediate human CLI fallback.
- If `status_claude_channel` reports the channel is not reachable, tell the user the channel is not running and ask them to start Claude Code with the `claude-cli-channel` channel enabled.

## CLI Fallback

Use this only when the Codex MCP tools are not installed or not available in the current thread:

```sh
claude-channel list
claude-channel status
claude-channel ask --to ep_ABC234 "From Codex: review this plan and return your answer with complete_channel_request."
printf '%s\n' "$prompt" | claude-channel ask-file --to ep_ABC234 -
```
