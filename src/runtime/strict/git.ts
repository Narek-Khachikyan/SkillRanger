import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export type SourceControlSnapshot =
  | { mode: "git"; base: string; head: string; patchSha256: string }
  | { mode: "non-git" };

export const captureSourceControl = async (projectRoot: string, base?: string): Promise<SourceControlSnapshot> => {
  try {
    const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: projectRoot })).stdout.trim();
    const resolvedBase = base ?? head;
    const patch = (await exec("git", ["diff", "--binary", resolvedBase], { cwd: projectRoot, maxBuffer: 32 * 1024 * 1024 })).stdout;
    return { mode: "git", base: resolvedBase, head, patchSha256: sha(patch) };
  } catch { return { mode: "non-git" }; }
};
