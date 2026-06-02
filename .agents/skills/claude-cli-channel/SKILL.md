---
name: claude-cli-channel
description: Use when Codex needs to send a coordination message into a user's live Claude Code session through the local claude-cli-channel channel, check whether the channel is reachable, or send a prompt to Claude Code without using API-mode Claude access.
---

# Claude CLI Channel

Use the local `claude-cli-channel` Codex MCP tools when they are installed. In a repository checkout without the Codex plugin installed, fall back to the `claude-channel` CLI. Both paths communicate with the user's live Claude Code session and preserve Claude Code's native harness.

## Workflow

1. List available Claude targets with `list_claude_targets` when the tool is available. If there is one target, use it. If there are several, show the numbered candidates and ask which visible Claude Code window to use.

2. Check the selected target with `status_claude_channel`, passing `target` when one was selected.

3. Send one-way messages with `tell_claude`, passing `target` when needed.

4. For requests that need a response in Codex, use `ask_claude`, passing `target` when needed.

5. If a tool returns `multiple_claude_targets`, ask the user to choose from `candidates`, then retry with that candidate's `endpoint_id`.

6. If MCP tools are unavailable, use the CLI fallback:

   ```sh
   claude-channel list
   claude-channel status
   claude-channel tell --to ep_ABC234 "From Codex: summarize current state and wait for the user."
   claude-channel ask --to ep_ABC234 "From Codex: review this plan and return your answer with complete_channel_request."
   ```

7. For generated multi-line CLI fallback prompts, stream stdin:

   ```sh
   printf '%s\n' "$prompt" | claude-channel ask-file --to ep_ABC234 -
   ```

8. Use prompt files only when the user explicitly points at a file or the repository owns a reusable prompt:

   ```sh
   claude-channel ask-file --to ep_ABC234 prompts/review.md
   ```

## Rules

- Do not use this skill for normal web/API Claude access. It is only for a local live Claude Code session.
- Use `tell_claude` or `tell` only when no response is needed. Use `ask_claude` or `ask` when Codex needs Claude Code's answer.
- Prefer MCP tools over CLI commands when both are available.
- When multiple live targets exist, ask the user to choose from `candidates`; never guess from branch names, task names, terminal titles, or transcript names.
- Prefer endpoint ids for retries and scripts. Numeric list indexes are acceptable only for immediate human CLI fallback.
- Prefer inline asks for short prompts and stdin/file input only for CLI fallback.
- Use `ask-file <path>` or `tell-file <path>` only for user-owned or repo-owned prompt files, not hidden temporary files.
- For review-sized asks, rely on the 30-minute default timeout unless the user asks for a different timeout.
- Treat `tell` delivery as best-effort.
- Keep Claude-facing prompts separate from Codex handling instructions. Send Claude only what Claude should answer.
- If the user says "verbatim", "exactly", "send this block", or gives a fenced/quoted prompt, send only that exact block as the Claude-facing prompt. Preserve wording, ordering, and whitespace.
- For long or multiline exact prompts, pass the block directly as MCP `message`. In CLI fallback, stream only that block to `ask-file -` or `tell-file -`; never include Codex-only handling instructions in file/stdin payloads.
- When content comes from another tool or plugin, summarize it only if the user asked for a summary. If the user asks to send it exactly, pass the selected text exactly.
- After `ask_claude` or `ask` returns, use the `answer` field. Do not dump raw JSON unless debugging.
- For very large CLI fallback reviews, redirect JSON to a visible file and parse `.answer` instead of relying on terminal output capture.
- If `claude-channel status` fails, tell the user the channel is not running and ask them to start Claude Code with the `claude-cli-channel` channel enabled.
- Keep messages explicit about their source, e.g. start with `From Codex:`.
