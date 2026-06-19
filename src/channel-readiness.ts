import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

export const CLAUDE_CHANNEL_CLIENT_CAPABILITY = "claude/channel";

export function isChannelReady(clientCapabilities: ClientCapabilities | undefined): boolean {
  return hasClaudeChannelClientCapability(clientCapabilities);
}

export function hasClaudeChannelClientCapability(clientCapabilities: ClientCapabilities | undefined): boolean {
  return clientCapabilities?.experimental?.[CLAUDE_CHANNEL_CLIENT_CAPABILITY] !== undefined;
}
