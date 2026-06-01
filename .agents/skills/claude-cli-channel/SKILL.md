---
name: claude-cli-channel
description: Use when Codex needs to send a coordination message into a user's live Claude Code session through the local claude-cli-channel channel, check whether the channel is reachable, or send a prompt to Claude Code without using API-mode Claude access.
---

# Claude CLI Channel

Use the local `claude-channel` CLI to communicate with the user's live Claude Code session. This preserves Claude Code's native harness and lets the user monitor the same session in their Claude Code window.

## Workflow

1. Check channel availability:

   ```sh
   claude-channel status
   ```

2. Send one-way messages directly:

   ```sh
   claude-channel tell "From Codex: summarize current state and wait for the user."
   ```

3. For requests that need a response in Codex, use `ask`:

   ```sh
   claude-channel ask "From Codex: review this plan and return your answer with complete_channel_request."
   ```

4. For generated multi-line prompts, stream stdin:

   ```sh
   printf '%s\n' "$prompt" | claude-channel ask-file -
   ```

5. Use prompt files only when the user explicitly points at a file or the repository owns a reusable prompt:

   ```sh
   claude-channel ask-file prompts/review.md
   ```

## Rules

- Do not use this skill for normal web/API Claude access. It is only for a local live Claude Code session.
- Use `tell` only when no response is needed. Use `ask` when Codex needs Claude Code's answer.
- Prefer inline `ask` for short prompts and `ask-file -` for generated multiline prompts.
- Use `ask-file <path>` or `tell-file <path>` only for user-owned or repo-owned prompt files, not hidden temporary files.
- For review-sized asks, rely on the 30-minute default timeout unless the user asks for a different timeout.
- Treat `tell` delivery as best-effort.
- Keep Claude-facing prompts separate from Codex handling instructions. Send Claude only what Claude should answer; keep instructions like "then decide whether you agree" for Codex after the tool output returns.
- After `ask` returns, parse the JSON and use the `answer` field. Do not dump raw JSON unless debugging.
- If `claude-channel status` fails, tell the user the channel is not running and ask them to start Claude Code with the `claude-cli-channel` channel enabled.
- Keep messages explicit about their source, e.g. start with `From Codex:`.
