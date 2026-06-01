#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCodexChannelMcpServer } from "./codex-mcp/server.js";

const server = createCodexChannelMcpServer();
await server.connect(new StdioServerTransport());
