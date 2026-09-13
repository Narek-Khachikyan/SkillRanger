import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { RunStore } from "../run-store.ts";
import { assertValidStrictSkillRun } from "./validation.ts";
import { StrictSkillRunError, type EvidenceArtifact, type SkillRunV2, type VerifiedRunDirection } from "./types.ts";
import { resolveCertifiedDirectionArtifact } from "./verification.ts";
import { resolveTrustedValidatorRegistry, type TrustedValidatorRegistryResolver } from "./validator-registry.ts";
import { finalizeRun as finalizeRunOperation, ingestEvidence as ingestEvidenceOperation, verifySkill as verifySkillOperation } from "./run-operations.ts";

const errno = (error: unknown, code: string) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
const digestBytes = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class StrictSkillRunStore {
  private readonly projectRootInput: string;
  private readonly core: RunStore<SkillRunV2>;
  private readonly trustedValidatorRegistry: TrustedValidatorRegistryResolver;

  get projectRoot(): string {
    return this.projectRootInput;
  }

  get lock() {
    return this.core.lock;
  }

  async readUnlocked(runId: string): Promise<SkillRunV2> {
    return this.core.readUnlocked(runId);
  }

  async writeUnlocked(run: SkillRunV2): Promise<string> {
    return this.core.writeUnlocked(run);
  }

  constructor(
    projectRoot: string,
    trustedValidatorRegistry: TrustedValidatorRegistryResolver = resolveTrustedValidatorRegistry,
  ) {
    this.projectRootInput = projectRoot;
    this.trustedValidatorRegistry = trustedValidatorRegistry;
    this.core = new RunStore(projectRoot, {
      runIdPattern: /^run_[a-z0-9_-]{7,127}$/,
      assertValidRun: assertValidStrictSkillRun,
      error: {
        invalidRunId: (runId) => new StrictSkillRunError("run-integrity", `Invalid run id ${runId}.`),
        notFound: (runId) => new StrictSkillRunError("run-not-found", `Strict run not found: ${runId}.`),
        invalidJson: (runId) => new StrictSkillRunError("run-integrity", `Strict run ${runId} is not valid JSON.`),
        idMismatch: () => new StrictSkillRunError("run-integrity", "Persisted strict run id mismatch."),
        lock: (message) => new StrictSkillRunError("run-integrity", message),
      },
      write: { unlinkCleanup: "ignore-all" },
    });
  }

  async create(run: SkillRunV2) {
    return this.core.create(run, {
      alreadyExists: (runId) => new StrictSkillRunError("run-integrity", `Strict run already exists: ${runId}.`),
    });
  }

  async read(runId: string) { return this.core.readUnlocked(runId); }

  /**
   * Read-only verified-runs enumeration: returns every persisted run in the terminal verified state
   * that carries a design-direction evidence artifact, newest first, with the direction's
   * content-addressed digest and parsed payload. Unverified runs and runs without a direction are
   * excluded; unreadable or integrity-broken entries are skipped because they cannot constrain a
   * comparison. No lock is taken: this capability never mutates run state.
   */
  async listVerifiedRuns(): Promise<VerifiedRunDirection[]> {
    const runsDir = path.join(this.projectRoot, ".skillranger", "runs");
    let entries: string[];
    try {
      entries = await readdir(runsDir);
    } catch (error) {
      if (errno(error, "ENOENT")) return [];
      throw error;
    }
    const verified: VerifiedRunDirection[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const runId = entry.slice(0, -".json".length);
      if (!/^run_[a-z0-9_-]{7,127}$/.test(runId)) continue;
      let run: SkillRunV2;
      try {
        run = await this.core.readUnlocked(runId);
      } catch {
        continue;
      }
      if (run.state !== "verified") continue;
      const directionArtifact = resolveCertifiedDirectionArtifact(run.skillLedgers, run.artifacts);
      if (!directionArtifact) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(path.join(this.projectRoot, directionArtifact.path));
      } catch {
        continue;
      }
      if (digestBytes(bytes) !== directionArtifact.sha256) continue;
      let direction: unknown;
      try {
        direction = JSON.parse(bytes.toString("utf8"));
      } catch {
        continue;
      }
      verified.push({
        runId,
        updatedAt: run.updatedAt,
        directionDigest: directionArtifact.sha256,
        direction,
      });
    }
    return verified.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async replace(runId: string, run: SkillRunV2) {
    return this.core.replace(runId, run, {
      idMismatch: () => new StrictSkillRunError("run-integrity", "A strict runtime replacement cannot change the run ID."),
      notAdvanced: () => new StrictSkillRunError("run-integrity", "A strict runtime replacement must advance the revision."),
    });
  }

  async update(runId: string, apply: (run: SkillRunV2) => SkillRunV2 | Promise<SkillRunV2>) {
    return this.core.update(runId, apply, {
      prepareNext: (current, next) => {
        if (next.runId !== runId || next.revision <= current.revision) throw new StrictSkillRunError("run-integrity", "Strict update must preserve id and advance revision.");
        if (current.state !== "verified" && next.state === "verified") throw new StrictSkillRunError("run-integrity", "Strict certification must be finalized by the run store.");
        return next;
      },
    });
  }

  async ingestEvidence(runId: string, input: {
    sourcePath: string;
    kind: string;
    validatedAs?: EvidenceArtifact["validatedAs"];
    attributions: EvidenceArtifact["attributions"];
  }) {
    return ingestEvidenceOperation(this, runId, input);
  }

  async verifySkill(runId: string, skillId: string) {
    return verifySkillOperation(this, runId, skillId, this.trustedValidatorRegistry);
  }

  async finalizeRun(runId: string) {
    return finalizeRunOperation(this, runId, this.trustedValidatorRegistry);
  }
}
