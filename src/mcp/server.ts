#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { handleJsonRpcLine } from "./protocol.ts";
import { initializeRouterContext } from "./router-context.ts";

const writeMessage = (message: unknown) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

export const startMcpServer = () => {
  initializeRouterContext();
  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  input.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    void (async () => {
      const response = await handleJsonRpcLine(trimmed);
      if (response) writeMessage(response);
    })();
  });

  return input;
};

const isDirectRun = () => {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  const resolveEntrypoint = (filePath: string) => {
    try {
      return realpathSync(filePath);
    } catch {
      return path.resolve(filePath);
    }
  };
  return resolveEntrypoint(entrypoint) === resolveEntrypoint(fileURLToPath(import.meta.url));
};

if (isDirectRun()) {
  startMcpServer();
}
