import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createBridgeHttpServer } from "../src/http/bridge-server.js";
import { PendingRequests } from "../src/pending-requests.js";
import { createAutoAnswerChannel, createTestClaudeChannel } from "./helpers.js";

type StartedServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function startServer(
  options: Partial<Parameters<typeof createBridgeHttpServer>[0]> = {},
): Promise<StartedServer> {
  const pendingRequests = options.pendingRequests ?? new PendingRequests();
  const channel = options.channel ?? createAutoAnswerChannel(pendingRequests);

  const server = createBridgeHttpServer({
    host: "127.0.0.1",
    token: "secret",
    maxBodyBytes: 1024,
    defaultAskTimeoutMs: 100,
    channel,
    endpoint: {
      renameDisplayName: async (displayName) => ({
        display_name: displayName.trim(),
      }),
    },
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
  token: string | null = "secret",
  headers: Record<string, string> = {},
): Promise<Response> {
  const requestHeaders: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  };
  if (token !== null) {
    requestHeaders.authorization ??= `Bearer ${token}`;
  }

  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: requestHeaders,
    body,
  });
}

async function responseJsonObject(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as unknown;
  assert.equal(typeof body, "object");
  assert.ok(body);
  assert.equal(Array.isArray(body), false);
  return body as Record<string, unknown>;
}

function patchDisplayName(
  baseUrl: string,
  body: unknown,
  token: string | null = "secret",
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
  };
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }

  return fetch(`${baseUrl}/display-name`, {
    method: "PATCH",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") {
    assert.fail(`${key} must be a string`);
  }
  return value;
}

test("GET /health returns health JSON", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/health`);
    const body = await responseJsonObject(response);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
  } finally {
    await server.close();
  }
});

test("GET /health parses routes independently of configured host syntax", async () => {
  const server = await startServer({ host: "::1" });
  try {
    const response = await fetch(`${server.baseUrl}/health`);
    const body = await responseJsonObject(response);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
  } finally {
    await server.close();
  }
});

test("POST /tell is not a supported route", async () => {
  const server = await startServer();
  try {
    const response = await post(server.baseUrl, "/tell", "hello");

    assert.equal(response.status, 404);
    assert.equal(await response.text(), "not found\n");
  } finally {
    await server.close();
  }
});

test("POST /ask waits for matching completion", async () => {
  const pendingRequests = new PendingRequests();
  const server = await startServer({ pendingRequests });

  try {
    const response = await post(server.baseUrl, "/ask", "question");
    const body = await responseJsonObject(response);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.match(stringField(body, "request_id"), /^req_/);
    assert.equal(body.status, "answered");
    assert.equal(body.answer, "ok");
  } finally {
    await server.close();
  }
});

test("POST /ask rejects requests without the expected bearer token", async () => {
  const server = await startServer();
  try {
    const responses = await Promise.all([
      post(server.baseUrl, "/ask", "hello", null),
      post(server.baseUrl, "/ask", "hello", null, { authorization: "secret" }),
      post(server.baseUrl, "/ask", "hello", "wrong"),
    ]);

    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.equal(await response.text(), "unauthorized\n");
    }
  } finally {
    await server.close();
  }
});

test("POST /ask validates sender metadata at ingress", async () => {
  const senders: Array<string | undefined> = [];
  const pendingRequests = new PendingRequests();
  const server = await startServer({
    pendingRequests,
    channel: createTestClaudeChannel({
      emitAsk: async (requestId, _content, meta) => {
        senders.push(meta?.sender);
        pendingRequests.complete({
          requestId,
          status: "answered",
          answer: "ok",
        });
      },
    }),
  });

  try {
    const valid = await post(server.baseUrl, "/ask", "hello", "secret", {
      "x-claude-channel-sender": "codex-review",
    });
    const invalid = await post(server.baseUrl, "/ask", "hello", "secret", {
      "x-claude-channel-sender": 'bad"sender',
    });

    assert.equal(valid.status, 200);
    assert.equal(invalid.status, 200);
    assert.deepEqual(senders, ["codex-review", "codex"]);
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
    channel: createTestClaudeChannel({
      emitAsk: async (requestId, content) => {
        asks.push(content);
        pendingRequests.complete({
          requestId,
          status: "answered",
          answer: "ok",
        });
      },
    }),
  });

  try {
    const response = await post(server.baseUrl, "/ask", prompt);

    assert.equal(response.status, 200);
    assert.deepEqual(asks, [prompt]);
  } finally {
    await server.close();
  }
});

test("POST /ask extracts message content from JSON bodies", async () => {
  const asks: string[] = [];
  const prompt = "\n  line one\n    line two\n";
  const pendingRequests = new PendingRequests();
  const server = await startServer({
    pendingRequests,
    channel: createTestClaudeChannel({
      emitAsk: async (requestId, content) => {
        asks.push(content);
        pendingRequests.complete({
          requestId,
          status: "answered",
          answer: "ok",
        });
      },
    }),
  });

  try {
    const response = await post(
      server.baseUrl,
      "/ask",
      JSON.stringify({ message: prompt }),
      "secret",
      { "content-type": "application/json; charset=utf-8" },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(asks, [prompt]);
  } finally {
    await server.close();
  }
});

test("POST /ask returns 400 for malformed JSON", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/ask`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "{",
    });

    assert.equal(response.status, 400);
    const body = await responseJsonObject(response);
    assert.equal(body.error, "invalid JSON request body");
  } finally {
    await server.close();
  }
});

test("POST /ask returns 400 for JSON without message", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/ask`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "{}",
    });

    assert.equal(response.status, 400);
    const body = await responseJsonObject(response);
    assert.equal(body.error, 'JSON requests must include a string "message" field');
  } finally {
    await server.close();
  }
});

test("POST /ask returns 413 for oversized bodies", async () => {
  const server = await startServer({ maxBodyBytes: 3 });
  try {
    const response = await post(server.baseUrl, "/ask", "large");

    assert.equal(response.status, 413);
    const body = await responseJsonObject(response);
    assert.match(stringField(body, "error"), /request body exceeds 3 bytes/);
  } finally {
    await server.close();
  }
});

test("POST /ask cancels the pending request when the caller disconnects", async () => {
  const emittedRequest = deferred<string>();
  const cancelledRequest = deferred<string>();
  class ObservedPendingRequests extends PendingRequests {
    override cancel(requestId: string, error: Error): boolean {
      const cancelled = super.cancel(requestId, error);
      if (cancelled) cancelledRequest.resolve(requestId);
      return cancelled;
    }
  }

  const pendingRequests = new ObservedPendingRequests();
  const server = await startServer({
    pendingRequests,
    defaultAskTimeoutMs: 60_000,
    channel: createTestClaudeChannel({
      emitAsk: async (requestId) => {
        emittedRequest.resolve(requestId);
      },
    }),
  });

  try {
    const request = http.request(`${server.baseUrl}/ask`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "text/plain; charset=utf-8",
      },
    });
    const closed = new Promise<void>((resolve) => {
      request.once("close", resolve);
    });
    request.once("error", () => {});
    request.end("question");

    const requestId = await emittedRequest.promise;
    request.destroy();

    await closed;
    assert.equal(await cancelledRequest.promise, requestId);
    assert.equal(pendingRequests.complete({
      requestId,
      status: "answered",
      answer: "late answer",
    }), false);
  } finally {
    await server.close();
  }
});

test("POST /ask returns 504 when Claude does not complete the request", async () => {
  const server = await startServer({
    defaultAskTimeoutMs: 5,
    channel: createTestClaudeChannel(),
  });

  try {
    const response = await post(server.baseUrl, "/ask", "question");
    const body = await responseJsonObject(response);

    assert.equal(response.status, 504);
    assert.match(stringField(body, "error"), /timed out waiting for Claude Code reply/);
  } finally {
    await server.close();
  }
});

test("PATCH /display-name renames the endpoint through the bridge owner", async () => {
  const renamed: string[] = [];
  const server = await startServer({
    endpoint: {
      renameDisplayName: async (displayName) => {
        renamed.push(displayName);
        return { display_name: displayName };
      },
    },
  });

  try {
    const response = await patchDisplayName(server.baseUrl, { display_name: " review-left " });
    const body = await responseJsonObject(response);

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      display_name: "review-left",
    });
    assert.deepEqual(renamed, ["review-left"]);
  } finally {
    await server.close();
  }
});

test("PATCH /display-name rejects requests without the expected bearer token", async () => {
  const server = await startServer();
  try {
    const responses = await Promise.all([
      patchDisplayName(server.baseUrl, { display_name: "review-left" }, null),
      patchDisplayName(server.baseUrl, { display_name: "review-left" }, "wrong"),
    ]);

    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.equal(await response.text(), "unauthorized\n");
    }
  } finally {
    await server.close();
  }
});

test("PATCH /display-name validates request JSON and display names", async () => {
  const server = await startServer();
  try {
    const malformed = await patchDisplayName(server.baseUrl, "{");
    const missing = await patchDisplayName(server.baseUrl, {});
    const reserved = await patchDisplayName(server.baseUrl, { display_name: "ep_ABC234" });

    assert.equal(malformed.status, 400);
    assert.equal(stringField(await responseJsonObject(malformed), "error"), "invalid JSON request body");
    assert.equal(missing.status, 400);
    assert.match(stringField(await responseJsonObject(missing), "error"), /display_name must be a non-empty string/);
    assert.equal(reserved.status, 400);
    assert.match(stringField(await responseJsonObject(reserved), "error"), /reserved target name/);
  } finally {
    await server.close();
  }
});

test("POST /ask returns generic 500 when emitting the channel request fails", async () => {
  const originalConsoleError = console.error;
  const server = await startServer({
    channel: createTestClaudeChannel({
      emitAsk: async () => {
        throw new Error("internal channel failure");
      },
    }),
  });

  try {
    console.error = () => {};
    const response = await post(server.baseUrl, "/ask", "question");
    const body = await responseJsonObject(response);

    assert.equal(response.status, 500);
    assert.deepEqual(body, { ok: false, error: "internal server error" });
  } finally {
    console.error = originalConsoleError;
    await server.close();
  }
});

test("POST /ask returns 400 for invalid timeout_ms", async () => {
  const server = await startServer();
  try {
    const response = await post(server.baseUrl, "/ask?timeout_ms=abc", "question");

    assert.equal(response.status, 400);
    const body = await responseJsonObject(response);
    assert.equal(body.error, "timeout_ms must be a positive integer");
  } finally {
    await server.close();
  }
});
