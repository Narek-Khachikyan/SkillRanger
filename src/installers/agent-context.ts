import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const startMarker = "<!-- SKILLRANGER_START -->";
const endMarker = "<!-- SKILLRANGER_END -->";
const startMarkerBytes = Buffer.from(startMarker, "ascii");
const endMarkerBytes = Buffer.from(endMarker, "ascii");
const newlineBytes = Buffer.from("\n", "ascii");

export type SkillRangerAgentContextPlan = {
  path: string;
  changed: boolean;
};

export const renderSkillRangerAgentBlock = () => [
  startMarker,
  "## SkillRanger Universal Prompt Router",
  "When the user's request ends with `@skillranger`, `skillranger`, or `/sr`, use the SkillRanger MCP workflow before implementation.",
  "1. Call `prepare_task` with the complete user request.",
  "2. If clarification is required, ask the user and call `prepare_task` again with the original request, continuation token, and answers.",
  "3. If decomposition or no-match is returned, report that outcome instead of inventing a workflow.",
  "4. For a prepared task, read every required instruction through `read_run_skill_file` in the returned order.",
  "5. If runtime clarification is returned, resolve it through `resolve_skill_run_clarifications` after required reads and before execution.",
  "6. Use the returned runtime run ID with the existing lifecycle or strict tools.",
  "7. Do not install skills automatically or execute skill package scripts.",
  "8. Do not claim `verified` unless SkillRanger runtime verification succeeds.",
  endMarker,
].join("\n");

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

const markerOffsets = (source: Buffer, marker: Buffer) => {
  const offsets: number[] = [];
  let offset = source.indexOf(marker);
  while (offset !== -1) {
    offsets.push(offset);
    offset = source.indexOf(marker, offset + marker.length);
  }
  return offsets;
};

const updatedSource = (source: Buffer) => {
  const starts = markerOffsets(source, startMarkerBytes);
  const ends = markerOffsets(source, endMarkerBytes);
  const newline = source.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
  const managedBlock = Buffer.from(renderSkillRangerAgentBlock().replaceAll("\n", newline), "utf8");
  const hasNoMarkers = starts.length === 0 && ends.length === 0;
  if (hasNoMarkers) {
    const needsSeparator = source.length > 0 && source[source.length - 1] !== newlineBytes[0];
    return Buffer.concat([
      source,
      ...(needsSeparator ? [newlineBytes] : []),
      managedBlock,
      newlineBytes,
    ]);
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0]) {
    throw new Error("malformed SkillRanger markers in AGENTS.md");
  }
  const managedEnd = ends[0] + endMarkerBytes.length;
  return Buffer.concat([
    source.subarray(0, starts[0]),
    managedBlock,
    source.subarray(managedEnd),
  ]);
};

const readAgentContext = async (agentPath: string) => {
  try {
    return await readFile(agentPath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return Buffer.alloc(0);
    throw error;
  }
};

export const planSkillRangerAgentContext = async (projectRoot: string): Promise<SkillRangerAgentContextPlan> => {
  const agentPath = path.join(path.resolve(projectRoot), "AGENTS.md");
  const source = await readAgentContext(agentPath);
  return {
    path: agentPath,
    changed: !updatedSource(source).equals(source),
  };
};

export const upsertSkillRangerAgentContext = async (projectRoot: string): Promise<SkillRangerAgentContextPlan> => {
  const agentPath = path.join(path.resolve(projectRoot), "AGENTS.md");
  const source = await readAgentContext(agentPath);
  const next = updatedSource(source);
  if (next.equals(source)) return { path: agentPath, changed: false };

  const temporary = `${agentPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(agentPath), { recursive: true });
  try {
    await writeFile(temporary, next, { flag: "wx" });
    await rename(temporary, agentPath);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT")) throw error;
    });
  }
  return { path: agentPath, changed: true };
};
