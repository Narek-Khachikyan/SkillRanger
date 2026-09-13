import { type RunFileLockHooks } from "../run-lock.ts";
import { RunStore } from "../run-store.ts";
import { SkillRunError, type SkillRun } from "./types.ts";
import { assertValidSkillRun, runIdPattern } from "./validation.ts";

export class SkillRunStore {
  private readonly projectRootInput: string;
  private readonly core: RunStore<SkillRun>;

  constructor(projectRoot: string, hooks: RunFileLockHooks = {}) {
    this.projectRootInput = projectRoot;
    this.core = new RunStore(projectRoot, {
      runIdPattern,
      assertValidRun: assertValidSkillRun,
      hooks,
      error: {
        invalidRunId: (runId) => new SkillRunError("run-integrity", `Invalid run id: ${runId}`),
        notFound: (runId) => new SkillRunError("run-not-found", `Skill run not found: ${runId}`),
        invalidJson: (runId) => new SkillRunError("run-integrity", `Skill run ${runId} is not valid JSON.`),
        idMismatch: () => new SkillRunError("run-integrity", "Persisted skill run ID does not match its file name."),
        lock: (message) => new SkillRunError("run-integrity", message),
        wrapReadError: (error) => new SkillRunError("run-integrity", `Could not read skill run: ${(error as Error).message}`),
      },
      write: { encoding: "utf8", unlinkCleanup: "ignore-enoent" },
    });
  }

  get projectRoot(): string { return this.projectRootInput; }

  async create(run: SkillRun): Promise<SkillRun> {
    return this.core.create(run, {
      beforeLock: (candidate) => {
        assertValidSkillRun(candidate);
        if (candidate.revision !== 0) throw new SkillRunError("run-integrity", "A new skill run must start at revision 0.");
      },
      alreadyExists: (runId) => new SkillRunError("run-integrity", `Skill run already exists: ${runId}`),
    });
  }

  async read(runId: string): Promise<SkillRun> {
    return this.core.readUnlocked(runId);
  }

  async replace(runId: string, run: SkillRun): Promise<SkillRun> {
    return this.core.replace(runId, run, {
      idMismatch: () => new SkillRunError("run-integrity", "A runtime replacement cannot change the run ID."),
      notAdvanced: () => new SkillRunError("run-integrity", "A runtime replacement must advance the revision."),
    });
  }

  async update(runId: string, apply: (run: SkillRun) => SkillRun | Promise<SkillRun>): Promise<SkillRun> {
    return this.core.update(runId, apply, {
      prepareNext: (current, reduced) => {
        if (reduced.runId !== runId) throw new SkillRunError("run-integrity", "A run update cannot change the run ID.");
        return { ...reduced, revision: current.revision + 1 };
      },
    });
  }
}

export { lockTimeoutMs, staleLockMs } from "../run-lock.ts";
