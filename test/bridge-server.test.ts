import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createBridgeHttpServer } from "../src/http/bridge-server.js";
import type { ClaudeChannel } from "../src/mcp/claude-channel.js";
import { PendingRequests } from "../src/pending-requests.js";
import type { ChannelEventMeta } from "../src/protocol.js";

type StartedServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

async function startServer(
  options: Partial<Parameters<typeof createBridgeHttpServer>[0]> = {},
): Promise<StartedServer> {
  const pendingRequests = options.pendingRequests ?? new PendingRequests();
  const channel =
    options.channel ??
    ({
      server: {} as ClaudeChannel["server"],
      emitTell: async () => {},
      emitAsk: async (requestId: string) => {
        pendingRequests.complete({
          requestId,
          status: "answered",
          answer: "ok",
        });
      },
    } satisfies ClaudeChannel);

  const server = createBridgeHttpServer({
    host: "127.0.0.1",
    token: "secret",
    maxBodyBytes: 1024,
    defaultAskTimeoutMs: 100,
    channel,
    pendingRequests,
    ...options,
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  const port = (address as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function post(
  baseUrl: string,
  path: string,
  body = "hello",
  token = "secret",
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
    body,
  });
}

test("GET /health returns health JSON", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    await server.close();
  }
});

test("POST /tell rejects unauthorized requests", async () => {
  const server = await startServer();
  try {
    const response = await post(server.baseUrl, "/tell", "hello", "wrong");

    assert.equal(response.status, 401);
    assert.equal(await response.text(), "unauthorized\n");
  } finally {
    await server.close();
  }
});

test("POST /tell emits a channel event", async () => {
  const tells: string[] = [];
  const server = await startServer({
    channel: {
      server: {} as ClaudeChannel["server"],
      emitTell: async (content) => {
        tells.push(content);
      },
      emitAsk: async () => {},
    },
  });

  try {
    const response = await post(server.baseUrl, "/tell", "hello");

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(tells, ["hello"]);
  } finally {
    await server.close();
  }
});

test("POST /tell preserves prompt whitespace", async () => {
  const tells: string[] = [];
  const prompt = "\n  line one\n    line two\n";
  const server = await startServer({
    channel: {
      server: {} as ClaudeChannel["server"],
      emitTell: async (content) => {
        tells.push(content);
      },
      emitAsk: async () => {},
    },
  });

  try {
    const response = await post(server.baseUrl, "/tell", prompt);

    assert.equal(response.status, 202);
    assert.deepEqual(tells, [prompt]);
  } finally {
    await server.close();
  }
});

test("POST /tell validates sender metadata at ingress", async () => {
  const senders: Array<string | undefined> = [];
  const server = await startServer({
    channel: {
      server: {} as ClaudeChannel["server"],
      emitTell: async (_content, meta?: ChannelEventMeta) => {
        senders.push(meta?.sender);
      },
      emitAsk: async () => {},
    },
  });

  try {
    const valid = await post(server.baseUrl, "/tell", "hello", "secret", {
      "x-claude-channel-sender": "codex-review",
    });
    const invalid = await post(server.baseUrl, "/tell", "hello", "secret", {
      "x-claude-channel-sender": 'bad"sender',
    });

    assert.equal(valid.status, 202);
    assert.equal(invalid.status, 202);
    assert.deepEqual(senders, ["codex-review", "codex"]);
  } finally {
    await server.close();
  }
});

test("POST /ask waits for matching completion", async () => {
  const pendingRequests = new PendingRequests();
  const server = await startServer({ pendingRequests });

  try {
    const response = await post(server.baseUrl, "/ask", "question");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.match(body.request_id, /^req_/);
    assert.equal(body.status, "answered");
    assert.equal(body.answer, "ok");
  } finally {
    await server.close();
  }
});

test("POST /ask preserves prompt whitespace", async () => {
  const asks: string[] = [];
  const prompt = "\n  review this\n    keep indentation\n";
  const pendingRequests = new PendingRequests();
  const server = await startServer({
    pendingRequests,
    channel: {
      server: {} as ClaudeChannel["server"],
      emitTell: async () => {},
      emitAsk: async (requestId, content) => {
        asks.push(content);
        pendingRequests.complete({
          requestId,
          status: "answered",
          answer: "ok",
        });
      },
    },
  });

  try {
    const response = await post(server.baseUrl, "/ask", prompt);

    assert.equal(response.status, 200);
    assert.deepEqual(asks, [prompt]);
  } finally {
    await server.close();
  }
});

test("POST /ask returns 504 when Claude does not complete the request", async () => {
  const server = await startServer({
    defaultAskTimeoutMs: 5,
    channel: {
      server: {} as ClaudeChannel["server"],
      emitTell: async () => {},
      emitAsk: async () => {},
    },
  });

  try {
    const response = await post(server.baseUrl, "/ask", "question");
    const body = await response.json();

    assert.equal(response.status, 504);
    assert.match(body.error, /timed out waiting for Claude Code reply/);
  } finally {
    await server.close();
  }
});

test("POST /ask returns generic 500 when emitting the channel request fails", async () => {
  const originalConsoleError = console.error;
  const server = await startServer({
    channel: {
      server: {} as ClaudeChannel["server"],
      emitTell: async () => {},
      emitAsk: async () => {
        throw new Error("internal channel failure");
      },
    },
  });

  try {
    console.error = () => {};
    const response = await post(server.baseUrl, "/ask", "question");
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { ok: false, error: "internal server error" });
  } finally {
    console.error = originalConsoleError;
    await server.close();
  }
});

test("POST /tell returns 400 for malformed JSON", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/tell`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "{",
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid JSON request body");
  } finally {
    await server.close();
  }
});

test("POST /tell returns 400 for JSON without message", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/tell`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "{}",
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'JSON requests must include a string "message" field');
  } finally {
    await server.close();
  }
});

test("POST /ask returns 400 for invalid timeout_ms", async () => {
  const server = await startServer();
  try {
    const response = await post(server.baseUrl, "/ask?timeout_ms=abc", "question");

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "timeout_ms must be a positive integer");
  } finally {
    await server.close();
  }
});

test("POST /tell returns 413 for oversized bodies", async () => {
  const server = await startServer({ maxBodyBytes: 3 });
  try {
    const response = await post(server.baseUrl, "/tell", "large");

    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /request body exceeds 3 bytes/);
  } finally {
    await server.close();
  }
});
