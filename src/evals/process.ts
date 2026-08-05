import { spawn } from "node:child_process";

export const parseCommandTemplate = (template: string): string[] => {
  const args: string[] = []; let current = ""; let quote: string | undefined;
  for (const character of template) {
    if (quote) { if (character === quote) quote = undefined; else current += character; }
    else if (character === "\"" || character === "'") quote = character;
    else if (/\s/.test(character)) { if (current) { args.push(current); current = ""; } }
    else current += character;
  }
  if (quote) throw new Error("Command template contains an unterminated quote.");
  if (current) args.push(current);
  return args;
};

export const substituteCommandPlaceholders = (args: string[], values: Record<string, string>) =>
  args.map((argument) => Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{{${name}}}`, value), argument));

export const runProcess = (command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}) => new Promise<{
  exitCode: number | null; signal: string | null; stdout: string; stderr: string; durationMs: number;
}>((resolve) => {
  const started = Date.now();
  const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = ""; let settled = false;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const finish = (exitCode: number | null, signal: string | null, error?: string) => {
    if (settled) return;
    settled = true;
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    resolve({
      exitCode: timedOut ? null : exitCode,
      signal: timedOut ? signal ?? "SIGTERM" : signal,
      stdout,
      stderr: error === undefined ? stderr : `${stderr}${error}`,
      durationMs: Date.now() - started,
    });
  };
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on("close", (exitCode, signal) => finish(exitCode, signal));
  child.on("error", (error) => finish(null, null, error.message));
  if (!settled && options.timeoutMs !== undefined && options.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill();
      }
    }, options.timeoutMs);
  }
});
