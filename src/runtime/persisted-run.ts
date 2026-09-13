import { readFile } from "node:fs/promises";
import path from "node:path";
import { SkillRunStore } from "./skill-run/store.ts";
import { SkillRunError, type SkillRun } from "./skill-run/types.ts";
import { StrictSkillRunStore } from "./strict/store.ts";
import { StrictSkillRunError, type SkillRunV2 } from "./strict/types.ts";

const runIdPattern = /^run_[a-z0-9_-]{7,127}$/;

export type PersistedRun =
  | { runtime: "lifecycle-v1"; run: SkillRun }
  | { runtime: "strict-v2"; run: SkillRunV2 };

export const persistedRunRuntime = (value: unknown): PersistedRun["runtime"] =>
  (value as { schemaVersion?: unknown })?.schemaVersion === "2.0" ? "strict-v2" : "lifecycle-v1";

export async function readPersistedRun(projectRoot: string, runId: string): Promise<PersistedRun> {
  if (!runIdPattern.test(runId)) throw new StrictSkillRunError("run-integrity", `Invalid run id ${runId}.`);
  const target = path.join(projectRoot, ".skillranger", "runs", `${runId}.json`);
  let source: string;
  try {
    source = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SkillRunError("run-not-found", `Skill run not found: ${runId}.`);
    throw new SkillRunError("run-integrity", `Skill run ${runId} is not valid persisted JSON.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new SkillRunError("run-integrity", `Skill run ${runId} is not valid persisted JSON.`);
  }
  if ((parsed as { schemaVersion?: unknown })?.schemaVersion === "2.0") {
    const run = await new StrictSkillRunStore(projectRoot).read(runId);
    return { runtime: "strict-v2", run };
  }
  const run = await new SkillRunStore(projectRoot).read(runId);
  return { runtime: "lifecycle-v1", run };
}
