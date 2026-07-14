import { spawn } from "node:child_process";

export const parseAdapterCommandTemplate = (template: string) => {
  const args: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const character of template) {
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (quote) throw new Error("Browser adapter command contains an unterminated quote.");
  if (current) args.push(current);
  if (args.length === 0) throw new Error("Browser adapter command must include an executable.");
  return args;
};

const runAdapter = (command: string, args: string[], cwd?: string, timeoutMs?: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Browser adapter exited with ${code ?? "no code"}: ${stderr.trim()}`));
    });
  });

export const executeAdapterJson = async (input: {
  commandTemplate: string;
  replacements: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}): Promise<unknown> => {
  const substituted = parseAdapterCommandTemplate(input.commandTemplate).map((argument) =>
    Object.entries(input.replacements).reduce(
      (result, [placeholder, replacement]) => result.replaceAll(placeholder, replacement),
      argument,
    ),
  );
  const [command, ...args] = substituted;
  const stdout = await runAdapter(command, args, input.cwd, input.timeoutMs);
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error("Browser adapter returned invalid JSON.");
  }
};
