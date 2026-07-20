import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG } from "../src/cli/claude-mcp.js";

type ReceivedRequest = {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  sender: string | string[] | undefined;
  contentType: string | string[] | undefined;
  body: string;
};

const CLI_TIMEOUT_MS = 5_000;

test("built CLI sends an ask request through the local channel registry", async () => {
  const repoDir = process.cwd();
  const tempHome = await mkdtemp(path.join(tmpdir(), "claude-channel-cli-smoke-"));
  let received: ReceivedRequest | undefined;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      received = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        sender: req.headers["x-claude-channel-sender"],
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8"),
      };

      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        request_id: "req_smoke123",
        status: "answered",
        answer: "smoke answer",
      }));
    });
  });

  try {
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);

    await writeChannelFixture({
      home: tempHome,
      port: (address as AddressInfo).port,
      projectDir: repoDir,
    });

    const result = await runCli([
      "ask",
      "--sender",
      "smoke-test",
      "--no-progress",
      "From",
      "smoke:",
      "hello",
    ], {
      cwd: repoDir,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        CLAUDE_CHANNEL_TARGET: "ep_ABC234",
      },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "smoke answer\n");
    assert.deepEqual(received, {
      method: "POST",
      url: "/ask?timeout_ms=1800000",
      authorization: "Bearer smoke-token",
      sender: "smoke-test",
      contentType: "text/plain; charset=utf-8",
      body: "From smoke: hello",
    });
  } finally {
    await closeServer(server);
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("built CLI renames a live channel endpoint", async () => {
  const repoDir = process.cwd();
  const tempHome = await mkdtemp(path.join(tmpdir(), "claude-channel-cli-smoke-"));
  let received: ReceivedRequest | undefined;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      received = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        sender: req.headers["x-claude-channel-sender"],
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8"),
      };

      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        display_name: "review-left",
      }));
    });
  });

  try {
    await listen(server);
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);

    await writeChannelFixture({
      home: tempHome,
      port: (address as AddressInfo).port,
      projectDir: repoDir,
    });

    const result = await runCli([
      "rename",
      "--to",
      "ep_ABC234",
      "review-left",
    ], {
      cwd: repoDir,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
      },
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "Renamed ep_ABC234 to review-left\n");
    assert.deepEqual(received, {
      method: "PATCH",
      url: "/display-name",
      authorization: "Bearer smoke-token",
      sender: undefined,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ display_name: "review-left" }),
    });
  } finally {
    await closeServer(server);
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("built receiver refuses stale persistent MCP launches before registering an endpoint", async () => {
  const repoDir = process.cwd();
  const tempHome = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const tempProject = await mkdtemp(path.join(tmpdir(), "claude-channel-project-"));
  const projectConfigPath = await realpath(tempProject);

  try {
    await writeFile(
      path.join(tempHome, ".claude.json"),
      JSON.stringify({
        projects: {
          [projectConfigPath]: {
            mcpServers: {
              "claude-channel-cli": {
                command: process.execPath,
                args: [path.join(repoDir, "dist/channel.js")],
              },
            },
          },
        },
      }),
      "utf8",
    );

    const result = await runNode([path.join(repoDir, "dist/channel.js")], {
      cwd: tempProject,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        CLAUDE_CHANNEL_PORT: "invalid",
      },
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Persistent Claude MCP registration/);
    assert.match(result.stderr, /claude mcp remove --scope local claude-channel-cli/);
    assert.doesNotMatch(result.stderr, /CLAUDE_CHANNEL_PORT|\n\s+at /);
    assert.deepEqual(await endpointFiles(tempHome), []);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
    await rm(tempProject, { recursive: true, force: true });
  }
});

test("built receiver reports marked startup configuration errors without a stack trace", async () => {
  const repoDir = process.cwd();
  const tempHome = await mkdtemp(path.join(tmpdir(), "claude-channel-home-"));
  const tempProject = await mkdtemp(path.join(tmpdir(), "claude-channel-project-"));

  try {
    const result = await runNode([
      path.join(repoDir, "dist/channel.js"),
      CLAUDE_CHANNEL_RECEIVER_LAUNCH_ARG,
    ], {
      cwd: tempProject,
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        CLAUDE_CHANNEL_PORT: "invalid",
      },
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /CLAUDE_CHANNEL_PORT must be a non-negative integer/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
    assert.deepEqual(await endpointFiles(tempHome), []);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
    await rm(tempProject, { recursive: true, force: true });
  }
});

async function writeChannelFixture(input: {
  home: string;
  port: number;
  projectDir: string;
}): Promise<void> {
  const bridgeDir = path.join(input.home, ".claude-channel");
  const endpointsDir = path.join(bridgeDir, "endpoints");
  const now = new Date().toISOString();

  await mkdir(endpointsDir, { recursive: true });
  await writeFile(path.join(bridgeDir, "token"), "smoke-token\n", "utf8");
  await writeFile(
    path.join(endpointsDir, "ep_ABC234.json"),
    `${JSON.stringify({
      schema_version: 1,
      endpoint_id: "ep_ABC234",
      host: "127.0.0.1",
      port: input.port,
      pid: process.pid,
      project_dir: input.projectDir,
      display_name: "claude-channel-cli",
      started_at: now,
      last_seen_at: now,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function runCli(args: string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return runNode([path.join(options.cwd, "dist/cli.js"), ...args], options);
}

async function runNode(args: string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, CLI_TIMEOUT_MS);

  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (timedOut) {
      throw new Error([
        `CLI timed out after ${CLI_TIMEOUT_MS}ms`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join("\n"));
    }
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

async function endpointFiles(home: string): Promise<string[]> {
  try {
    return await readdir(path.join(home, ".claude-channel", "endpoints"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error && !isServerNotRunningError(error)) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isServerNotRunningError(error: Error): boolean {
  return "code" in error && error.code === "ERR_SERVER_NOT_RUNNING";
}
