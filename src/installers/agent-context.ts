import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const startMarker = "<!-- SKILLRANGER_START -->";
const endMarker = "<!-- SKILLRANGER_END -->";

export type SkillRangerAgentContextPlan = {
  path: string;
  changed: boolean;
};

export const renderSkillRangerAgentBlock = () => [
  startMarker,
  "## SkillRanger lifecycle",
  "Before skill-driven work, run `skillranger run:start`, announce the selected primary and companion skills, and record every required SKILL.md read. Resolve required clarifications, then run `skillranger run:begin` immediately before implementation. Do not claim `verified` unless `skillranger run:verify` returns the verified outcome with recorded evidence.",
  endMarker,
].join("\n");

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

const markerOffsets = (source: string, marker: string) => {
  const offsets: number[] = [];
  let offset = source.indexOf(marker);
  while (offset !== -1) {
    offsets.push(offset);
    offset = source.indexOf(marker, offset + marker.length);
  }
  return offsets;
};

const updatedSource = (source: string) => {
  const starts = markerOffsets(source, startMarker);
  const ends = markerOffsets(source, endMarker);
  const hasNoMarkers = starts.length === 0 && ends.length === 0;
  if (hasNoMarkers) {
    const separator = source.length > 0 && !source.endsWith("\n") ? "\n" : "";
    return `${source}${separator}${renderSkillRangerAgentBlock()}\n`;
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0]) {
    throw new Error("malformed SkillRanger markers in AGENTS.md");
  }
  const managedEnd = ends[0] + endMarker.length;
  return `${source.slice(0, starts[0])}${renderSkillRangerAgentBlock()}${source.slice(managedEnd)}`;
};

const readAgentContext = async (agentPath: string) => {
  try {
    return await readFile(agentPath, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return "";
    throw error;
  }
};

export const planSkillRangerAgentContext = async (projectRoot: string): Promise<SkillRangerAgentContextPlan> => {
  const agentPath = path.join(path.resolve(projectRoot), "AGENTS.md");
  const source = await readAgentContext(agentPath);
  return {
    path: agentPath,
    changed: updatedSource(source) !== source,
  };
};

export const upsertSkillRangerAgentContext = async (projectRoot: string): Promise<SkillRangerAgentContextPlan> => {
  const agentPath = path.join(path.resolve(projectRoot), "AGENTS.md");
  const source = await readAgentContext(agentPath);
  const next = updatedSource(source);
  if (next === source) return { path: agentPath, changed: false };

  const temporary = `${agentPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(agentPath), { recursive: true });
  try {
    await writeFile(temporary, next, { encoding: "utf8", flag: "wx" });
    await rename(temporary, agentPath);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT")) throw error;
    });
  }
  return { path: agentPath, changed: true };
};
