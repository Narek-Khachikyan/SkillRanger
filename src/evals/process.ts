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
  const child = spawn(command, args, { cwd: options.cwd, timeout: options.timeoutMs, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = ""; let settled = false;
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on("close", (exitCode, signal) => { if (!settled) { settled = true; resolve({ exitCode, signal, stdout, stderr, durationMs: Date.now() - started }); } });
  child.on("error", (error) => { if (!settled) { settled = true; resolve({ exitCode: null, signal: null, stdout, stderr: `${stderr}${error.message}`, durationMs: Date.now() - started }); } });
});
