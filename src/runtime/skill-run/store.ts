import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SkillRunError, type SkillRun } from "./types.ts";
import { assertValidSkillRun, runIdPattern } from "./validation.ts";

const lockTimeoutMs = 5_000;
const staleLockMs = 30_000;

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

export class SkillRunStore {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  private runPath(runId: string): string {
    if (!runIdPattern.test(runId)) throw new SkillRunError("run-integrity", `Invalid run id: ${runId}`);
    return path.join(this.projectRoot, ".skillranger", "runs", `${runId}.json`);
  }

  private lockPath(runId: string): string {
    return `${this.runPath(runId).slice(0, -5)}.lock`;
  }

  private async acquireLock(runId: string): Promise<{ path: string; token: string }> {
    const lockPath = this.lockPath(runId);
    await mkdir(path.dirname(lockPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      const token = randomUUID();
      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(token, "utf8");
        } catch (error) {
          await handle.close();
          await unlink(lockPath).catch(() => undefined);
          throw error;
        }
        await handle.close();
        return { path: lockPath, token };
      } catch (error) {
        if (!isErrno(error, "EEXIST")) {
          if (error instanceof SkillRunError) throw error;
          throw new SkillRunError("run-integrity", `Could not acquire run lock: ${(error as Error).message}`);
        }
        try {
          const lockStat = await stat(lockPath);
          if (Date.now() - lockStat.mtimeMs > staleLockMs) {
            await unlink(lockPath);
            continue;
          }
        } catch (statError) {
          if (isErrno(statError, "ENOENT")) continue;
          throw new SkillRunError("run-integrity", `Could not inspect run lock: ${(statError as Error).message}`);
        }
        if (Date.now() - startedAt >= lockTimeoutMs) {
          throw new SkillRunError("run-integrity", "Timed out waiting for run lock");
        }
        await delay(25);
      }
    }
  }

  private async releaseLock(lock: { path: string; token: string }): Promise<void> {
    try {
      if (await readFile(lock.path, "utf8") === lock.token) await unlink(lock.path);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
    }
  }

  private async writeUnlocked(run: SkillRun): Promise<string> {
    assertValidSkillRun(run);
    const target = this.runPath(run.runId);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
      return target;
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isErrno(error, "ENOENT")) throw error;
      });
    }
  }

  private async readUnlocked(runId: string): Promise<SkillRun> {
    const target = this.runPath(runId);
    let source: string;
    try {
      source = await readFile(target, "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) throw new SkillRunError("run-not-found", `Skill run not found: ${runId}`);
      throw new SkillRunError("run-integrity", `Could not read skill run: ${(error as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new SkillRunError("run-integrity", `Skill run ${runId} is not valid JSON.`);
    }
    assertValidSkillRun(parsed);
    if (parsed.runId !== runId) throw new SkillRunError("run-integrity", "Persisted skill run ID does not match its file name.");
    return parsed;
  }

  async create(run: SkillRun): Promise<SkillRun> {
    assertValidSkillRun(run);
    if (run.revision !== 0) throw new SkillRunError("run-integrity", "A new skill run must start at revision 0.");
    const lock = await this.acquireLock(run.runId);
    try {
      try {
        await stat(this.runPath(run.runId));
        throw new SkillRunError("run-integrity", `Skill run already exists: ${run.runId}`);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
      await this.writeUnlocked(run);
      return run;
    } finally {
      await this.releaseLock(lock);
    }
  }

  async read(runId: string): Promise<SkillRun> {
    return this.readUnlocked(runId);
  }

  async update(runId: string, apply: (run: SkillRun) => SkillRun | Promise<SkillRun>): Promise<SkillRun> {
    const lock = await this.acquireLock(runId);
    try {
      const current = await this.readUnlocked(runId);
      const reduced = await apply(structuredClone(current));
      if (reduced.runId !== runId) throw new SkillRunError("run-integrity", "A run update cannot change the run ID.");
      const next = { ...reduced, revision: current.revision + 1 };
      assertValidSkillRun(next);
      await this.writeUnlocked(next);
      return next;
    } finally {
      await this.releaseLock(lock);
    }
  }
}

export { lockTimeoutMs, staleLockMs };
