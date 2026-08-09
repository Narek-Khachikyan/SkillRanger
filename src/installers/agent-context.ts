import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  catalogDiscoveryGuidance,
  catalogRefreshGuidance,
  completeRoleAwareNominationGuidance,
  explicitTriggerGuidance,
  fallbackRecallGuidance,
  legacyCatalogGuidance,
  mandatoryReadGuidance,
  managedGuidanceBoundary,
  proposalIntegrityGuidance,
  setupBoundaryGuidance,
} from "../host-guidance.ts";

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
  explicitTriggerGuidance,
  managedGuidanceBoundary,
  `1. ${catalogDiscoveryGuidance}`,
  `1a. ${completeRoleAwareNominationGuidance}`,
  `1b. ${fallbackRecallGuidance}`,
  `1c. ${proposalIntegrityGuidance}`,
  `2. ${legacyCatalogGuidance}`,
  `3. ${catalogRefreshGuidance}`,
  "4. Call `prepare_task` with the complete user request verbatim. Do not remove, move, or rewrite the trigger, and do not submit `semanticHints` with a `routingProposal`.",
  "5. If routing clarification is required, ask only the returned routing question, then call `prepare_task` again with the original complete request, continuation token, and typed answers.",
  "6. If decomposition or no-match is returned, report that outcome instead of inventing a workflow.",
  `7. ${mandatoryReadGuidance} Each new read uses a freshly generated RFC 4122 UUID and the latest returned readRevision; retry a transport failure with the identical request.`,
  "8. Do not call lifecycle clarification or execution tools before mandatory reads complete. `runtimeClarification` applies to the returned runtime run ID, never the router run ID.",
  "9. Resolve runtime clarification from facts in the request. For an allowed decline, continue with one neutral explicit assumption per declined field instead of asking the user; ask only when a non-declinable question cannot be answered from the request.",
  "10. Begin the returned runtime run only after the reads and any runtime clarification complete, then implement the original request without stopping for a plan or confirmation unless the user asked for one.",
  "10a. Branch on `run.runtime`. For `lifecycle-v1` use `begin_skill_run_execution`, `complete_skill_run`, and `verify_skill_run`. For `strict-v2` use `read_next_skill_chunk`, `begin_skill_step`, `add_skill_evidence`, `complete_skill_step`, `verify_skill`, and `finalize_skill_run`. The lifecycle-v1 transition tools reject a strict-v2 run; never mix the two families on one run. `inspect_skill_run` reads either runtime.",
  `11. ${setupBoundaryGuidance}`,
  "12. Do not install skills automatically or execute skill package scripts.",
  "13. Do not claim `verified` unless SkillRanger runtime verification succeeds.",
  "13a. A `run-blocked` error from `finalize_skill_run` means no verified result exists. Report its `userMessage` and `blockedSkills` verbatim; never describe such a run as passed, processed, or complete.",
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
