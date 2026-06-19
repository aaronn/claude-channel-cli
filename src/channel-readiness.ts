import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

export const CLAUDE_CHANNEL_CLIENT_CAPABILITY = "claude/channel";

export type ChannelReadiness =
  | { ready: true; reason: "client_capability" }
  | { ready: false; reason: "missing_channel_capability" };

export function detectChannelReadiness(clientCapabilities: ClientCapabilities | undefined): ChannelReadiness {
  if (hasClaudeChannelClientCapability(clientCapabilities)) {
    return { ready: true, reason: "client_capability" };
  }

  return { ready: false, reason: "missing_channel_capability" };
}

export function hasClaudeChannelClientCapability(clientCapabilities: ClientCapabilities | undefined): boolean {
  return clientCapabilities?.experimental?.[CLAUDE_CHANNEL_CLIENT_CAPABILITY] !== undefined;
}
