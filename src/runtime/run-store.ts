import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { RunFileLock, type RunFileLockHooks } from "./run-lock.ts";

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;

export type RunStoreConfig<TRun extends { runId: string; revision: number }> = {
  runIdPattern: RegExp;
  assertValidRun: (run: unknown) => asserts run is TRun;
  hooks?: RunFileLockHooks;
  error: {
    invalidRunId: (runId: string) => Error;
    notFound: (runId: string) => Error;
    invalidJson: (runId: string) => Error;
    idMismatch: () => Error;
    lock: (message: string) => Error;
    wrapReadError?: (error: unknown) => Error;
  };
  write: {
    encoding?: "utf8";
    unlinkCleanup: "ignore-all" | "ignore-enoent";
  };
};

export class RunStore<TRun extends { runId: string; revision: number }> {
  readonly projectRoot: string;
  private readonly config: RunStoreConfig<TRun>;
  readonly lock: RunFileLock;

  constructor(projectRoot: string, config: RunStoreConfig<TRun>) {
    this.projectRoot = projectRoot;
    this.config = config;
    this.lock = new RunFileLock({
      lockPath: (runId) => `${this.runPath(runId).slice(0, -5)}.lock`,
      error: config.error.lock,
      ...(config.hooks ? { hooks: config.hooks } : {}),
    });
  }

  runPath(runId: string): string {
    if (!this.config.runIdPattern.test(runId)) throw this.config.error.invalidRunId(runId);
    return path.join(this.projectRoot, ".skillranger", "runs", `${runId}.json`);
  }

  async readUnlocked(runId: string): Promise<TRun> {
    const target = this.runPath(runId);
    let source: string;
    try {
      source = await readFile(target, "utf8");
    } catch (error) {
      if (isErrno(error, "ENOENT")) throw this.config.error.notFound(runId);
      if (this.config.error.wrapReadError) throw this.config.error.wrapReadError(error);
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      if (error instanceof SyntaxError) throw this.config.error.invalidJson(runId);
      if (this.config.error.wrapReadError) throw this.config.error.invalidJson(runId);
      throw error;
    }
    this.config.assertValidRun(parsed);
    if (parsed.runId !== runId) throw this.config.error.idMismatch();
    return parsed;
  }

  async writeUnlocked(run: TRun): Promise<string> {
    this.config.assertValidRun(run);
    const target = this.runPath(run.runId);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const payload = `${JSON.stringify(run, null, 2)}\n`;
      if (this.config.write.encoding) {
        await writeFile(temporary, payload, { encoding: this.config.write.encoding, flag: "wx" });
      } else {
        await writeFile(temporary, payload, { flag: "wx" });
      }
      await rename(temporary, target);
      return target;
    } finally {
      if (this.config.write.unlinkCleanup === "ignore-enoent") {
        await unlink(temporary).catch((error: unknown) => {
          if (!isErrno(error, "ENOENT")) throw error;
        });
      } else {
        await unlink(temporary).catch(() => undefined);
      }
    }
  }

  async read(runId: string): Promise<TRun> {
    return this.readUnlocked(runId);
  }

  async create(
    run: TRun,
    hooks: {
      beforeLock?: (run: TRun) => void;
      alreadyExists: (runId: string) => Error;
    },
  ): Promise<TRun> {
    hooks.beforeLock?.(run);
    const lock = await this.lock.acquire(run.runId);
    try {
      try {
        await stat(this.runPath(run.runId));
        throw hooks.alreadyExists(run.runId);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
      await this.writeUnlocked(run);
      return run;
    } finally {
      await this.lock.release(lock);
    }
  }

  async replace(
    runId: string,
    run: TRun,
    hooks: {
      idMismatch: () => Error;
      notAdvanced: () => Error;
    },
  ): Promise<TRun> {
    if (run.runId !== runId) throw hooks.idMismatch();
    const lock = await this.lock.acquire(runId);
    try {
      const current = await this.readUnlocked(runId);
      if (run.revision <= current.revision) throw hooks.notAdvanced();
      await this.writeUnlocked(run);
      return run;
    } finally {
      await this.lock.release(lock);
    }
  }

  async update(
    runId: string,
    apply: (run: TRun) => TRun | Promise<TRun>,
    hooks: {
      prepareNext: (current: TRun, applied: TRun) => TRun;
    },
  ): Promise<TRun> {
    const lock = await this.lock.acquire(runId);
    try {
      const current = await this.readUnlocked(runId);
      const applied = await apply(structuredClone(current));
      const next = hooks.prepareNext(current, applied);
      await this.writeUnlocked(next);
      return next;
    } finally {
      await this.lock.release(lock);
    }
  }
}
