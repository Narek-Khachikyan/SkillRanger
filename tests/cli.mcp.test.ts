import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const waitForStdoutLine = (child: ReturnType<typeof spawn>) => new Promise<string>((resolve, reject) => {
  let output = "";
  const timeout = setTimeout(() => {
    cleanup();
    reject(new Error("Timed out waiting for MCP stdout."));
  }, 5_000);

  const cleanup = () => {
    clearTimeout(timeout);
    child.stdout.off("data", onData);
    child.off("error", onError);
    child.off("exit", onExit);
  };
  const onData = (chunk: Buffer) => {
    output += chunk.toString("utf8");
    const newlineIndex = output.indexOf("\n");
    if (newlineIndex === -1) return;
    cleanup();
    resolve(output.slice(0, newlineIndex));
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    cleanup();
    reject(new Error(`MCP process exited before responding: code ${code ?? "null"}, signal ${signal ?? "null"}.`));
  };

  child.stdout.on("data", onData);
  child.once("error", onError);
  child.once("exit", onExit);
});

test("skillranger mcp starts the stdio MCP server without CLI output", async () => {
  const child = spawn(process.execPath, ["src/cli/index.ts", "mcp"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  try {
    const stdoutLinePromise = waitForStdoutLine(child);
    child.stdin.end(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "cli-mcp-test",
          version: "0.0.0"
        }
      }
    })}\n`);

    const stdoutLine = await stdoutLinePromise;
    const response = JSON.parse(stdoutLine) as {
      result?: {
        serverInfo?: {
          name?: string;
          title?: string;
        };
      };
    };

    assert.equal(response.result?.serverInfo?.name, "skillranger");
    assert.equal(response.result?.serverInfo?.title, "SkillRanger");
  } finally {
    child.kill();
  }
});
