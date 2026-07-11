import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SkillRunError, type SkillRun } from "./types.ts";
import { assertValidSkillRun, runIdPattern } from "./validation.ts";

const lockTimeoutMs = 5_000;
const staleLockMs = 30_000;

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

type OwnedLock = { path: string; token: string };
type LockGuard = { path: string; entryPath: string };

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

  private async guardOwnerIsAlive(entryPath: string, entryName: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(await readFile(entryPath, "utf8")) as unknown;
      if (
        typeof parsed !== "object"
        || parsed === null
        || (parsed as { token?: unknown }).token !== entryName
        || !Number.isInteger((parsed as { pid?: unknown }).pid)
      ) return true;
      const pid = (parsed as { pid: number }).pid;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return !isErrno(error, "ESRCH");
      }
    } catch (error) {
      return !isErrno(error, "ENOENT");
    }
  }

  private async reclaimGuardIfAbandoned(guardPath: string): Promise<void> {
    let guardStat;
    let entries: string[];
    try {
      [guardStat, entries] = await Promise.all([stat(guardPath), readdir(guardPath)]);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return;
      throw error;
    }
    const stale = Date.now() - guardStat.mtimeMs > staleLockMs;
    const ownersDead = entries.length > 0 && (await Promise.all(
      entries.map((entry) => this.guardOwnerIsAlive(path.join(guardPath, entry), entry)),
    )).every((alive) => !alive);
    if (!stale && !ownersDead) return;

    for (const entry of entries) {
      await unlink(path.join(guardPath, entry)).catch((error: unknown) => {
        if (!isErrno(error, "ENOENT")) throw error;
      });
    }
    await rmdir(guardPath).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT") && !isErrno(error, "ENOTEMPTY")) throw error;
    });
  }

  private async acquireGuard(lockPath: string, startedAt: number): Promise<LockGuard> {
    const guardPath = `${lockPath}.guard`;
    while (true) {
      const token = randomUUID();
      try {
        await mkdir(guardPath);
        const entryPath = path.join(guardPath, token);
        try {
          await writeFile(entryPath, JSON.stringify({ token, pid: process.pid }), { encoding: "utf8", flag: "wx" });
          return { path: guardPath, entryPath };
        } catch (error) {
          await rmdir(guardPath).catch(() => undefined);
          if (isErrno(error, "ENOENT")) continue;
          throw error;
        }
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
        await this.reclaimGuardIfAbandoned(guardPath);
      }
      if (Date.now() - startedAt >= lockTimeoutMs) {
        throw new SkillRunError("run-integrity", "Timed out waiting for run lock");
      }
      await delay(25);
    }
  }

  private async releaseGuard(guard: LockGuard): Promise<void> {
    await unlink(guard.entryPath).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT")) throw error;
    });
    await rmdir(guard.path).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT") && !isErrno(error, "ENOTEMPTY")) throw error;
    });
  }

  private async withLockGuard<T>(lockPath: string, startedAt: number, apply: () => Promise<T>): Promise<T> {
    const guard = await this.acquireGuard(lockPath, startedAt);
    try {
      return await apply();
    } finally {
      await this.releaseGuard(guard);
    }
  }

  private async createLockWhileGuarded(lockPath: string, token: string): Promise<OwnedLock | undefined> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let handle;
      try {
        handle = await open(lockPath, "wx");
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
        try {
          const lockStat = await stat(lockPath);
          if (Date.now() - lockStat.mtimeMs <= staleLockMs) return undefined;
          await unlink(lockPath);
          continue;
        } catch (statError) {
          if (isErrno(statError, "ENOENT")) continue;
          throw statError;
        }
      }

      try {
        await handle.writeFile(token, "utf8");
        await handle.close();
        return { path: lockPath, token };
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch((unlinkError: unknown) => {
          if (!isErrno(unlinkError, "ENOENT")) throw unlinkError;
        });
        throw error;
      }
    }
    return undefined;
  }

  private async acquireLock(runId: string): Promise<OwnedLock> {
    const lockPath = this.lockPath(runId);
    await mkdir(path.dirname(lockPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      const token = randomUUID();
      try {
        const lock = await this.withLockGuard(lockPath, startedAt, () => this.createLockWhileGuarded(lockPath, token));
        if (lock) return lock;
      } catch (error) {
        if (error instanceof SkillRunError) throw error;
        throw new SkillRunError("run-integrity", `Could not acquire run lock: ${(error as Error).message}`);
      }
      if (Date.now() - startedAt >= lockTimeoutMs) {
        throw new SkillRunError("run-integrity", "Timed out waiting for run lock");
      }
      await delay(25);
    }
  }

  private async releaseLock(lock: OwnedLock): Promise<void> {
    try {
      await this.withLockGuard(lock.path, Date.now(), async () => {
        try {
          if (await readFile(lock.path, "utf8") === lock.token) await unlink(lock.path);
        } catch (error) {
          if (!isErrno(error, "ENOENT")) throw error;
        }
      });
    } catch (error) {
      if (error instanceof SkillRunError) throw error;
      throw new SkillRunError("run-integrity", `Could not release run lock: ${(error as Error).message}`);
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
