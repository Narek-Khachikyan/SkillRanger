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
  "## SkillRanger lifecycle",
  "Before skill-driven work, run `skillranger run:start`, announce the selected primary and companion skills, and record every required SKILL.md read. Resolve required clarifications, then run `skillranger run:begin` immediately before implementation. Do not claim `verified` unless `skillranger run:verify` returns the verified outcome with recorded evidence.",
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
  const managedBlock = Buffer.from(renderSkillRangerAgentBlock(), "utf8");
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
