import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const lockTimeoutMs = 5_000;
const staleLockMs = 30_000;
const unknownOwnerMaxAgeMs = 300_000;
const emptyGuardStaleMs = 250;

const isErrno = (error: unknown, code: string): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error && error.code === code
);

export type OwnedRunLock = { path: string; token: string };
type LockGuard = { path: string; entryPath: string };

export type ProcessIdentity = {
  scheme: "linux-proc-start-ticks";
  value: string;
};

export type ProcessIdentityState =
  | { status: "dead" }
  | { status: "known"; identity: ProcessIdentity }
  | { status: "unknown" };

export type ProcessIdentityProvider = {
  lookup(pid: number): Promise<ProcessIdentityState>;
};

type LegacyLockOwnerMetadata = { token: string; pid: number; version?: undefined };
type LockOwnerMetadataV2 = {
  version: 2;
  token: string;
  pid: number;
  createdAt: string;
  identity?: ProcessIdentity;
};
type LockOwnerMetadata = LegacyLockOwnerMetadata | LockOwnerMetadataV2;

const defaultProcessIdentityProvider: ProcessIdentityProvider = {
  async lookup(pid) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      return isErrno(error, "ESRCH") ? { status: "dead" } : { status: "unknown" };
    }

    if (process.platform !== "linux") return { status: "unknown" };
    try {
      const source = await readFile(`/proc/${pid}/stat`, "utf8");
      const commandEnd = source.lastIndexOf(")");
      if (commandEnd < 0) return { status: "unknown" };
      const fieldsAfterCommand = source.slice(commandEnd + 1).trim().split(/\s+/);
      const startTicks = fieldsAfterCommand[19];
      if (startTicks === undefined || !/^\d+$/.test(startTicks)) return { status: "unknown" };
      return {
        status: "known",
        identity: { scheme: "linux-proc-start-ticks", value: startTicks },
      };
    } catch {
      return { status: "unknown" };
    }
  },
};

export type RunFileLockHooks = {
  beforeGuardPublish?: (input: { guardPath: string; candidatePath: string; token: string }) => void | Promise<void>;
  guardEntered?: () => void | Promise<void>;
  guardExited?: () => void | Promise<void>;
};

export class RunFileLock {
  private readonly input: {
    lockPath: (runId: string) => string;
    error: (message: string) => Error;
    hooks?: RunFileLockHooks;
    identityProvider: ProcessIdentityProvider;
    lockTimeoutMs: number;
    staleLockMs: number;
    unknownOwnerMaxAgeMs: number;
  };
  private readonly ownErrors = new WeakSet<Error>();

  constructor(input: {
    lockPath: (runId: string) => string;
    error: (message: string) => Error;
    hooks?: RunFileLockHooks;
    identityProvider?: ProcessIdentityProvider;
    lockTimeoutMs?: number;
    staleLockMs?: number;
    unknownOwnerMaxAgeMs?: number;
  }) {
    this.input = {
      ...input,
      identityProvider: input.identityProvider ?? defaultProcessIdentityProvider,
      lockTimeoutMs: input.lockTimeoutMs ?? lockTimeoutMs,
      staleLockMs: input.staleLockMs ?? staleLockMs,
      unknownOwnerMaxAgeMs: input.unknownOwnerMaxAgeMs ?? unknownOwnerMaxAgeMs,
    };
  }

  private error(message: string): Error {
    const error = this.input.error(message);
    this.ownErrors.add(error);
    return error;
  }

  private async lookupIdentity(pid: number): Promise<ProcessIdentityState> {
    return this.input.identityProvider.lookup(pid).catch(() => ({ status: "unknown" }));
  }

  private async createOwnerMetadata(token: string): Promise<LockOwnerMetadataV2> {
    const state = await this.lookupIdentity(process.pid);
    return {
      version: 2,
      token,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ...(state.status === "known" ? { identity: state.identity } : {}),
    };
  }

  private parseOwnerMetadata(source: string, expectedToken?: string): LockOwnerMetadata | undefined {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (
        typeof parsed !== "object"
        || parsed === null
        || typeof (parsed as { token?: unknown }).token !== "string"
        || (expectedToken !== undefined && (parsed as { token: string }).token !== expectedToken)
        || !Number.isInteger((parsed as { pid?: unknown }).pid)
        || (parsed as { pid: number }).pid <= 0
      ) return undefined;
      const record = parsed as Record<string, unknown>;
      if (record.version === undefined) {
        return { token: record.token as string, pid: record.pid as number };
      }
      if (
        record.version !== 2
        || typeof record.createdAt !== "string"
        || record.createdAt.trim() === ""
        || (
          record.identity !== undefined
          && (
            typeof record.identity !== "object"
            || record.identity === null
            || (record.identity as { scheme?: unknown }).scheme !== "linux-proc-start-ticks"
            || typeof (record.identity as { value?: unknown }).value !== "string"
            || (record.identity as { value: string }).value.trim() === ""
          )
        )
      ) return undefined;
      return record as LockOwnerMetadataV2;
    } catch {
      return undefined;
    }
  }

  private identitiesMatch(left: ProcessIdentity, right: ProcessIdentity): boolean {
    return left.scheme === right.scheme && left.value === right.value;
  }

  private async retainOwner(owner: LockOwnerMetadata | undefined, age: number): Promise<boolean> {
    if (age <= this.input.staleLockMs) return true;
    if (owner?.version !== 2 || owner.identity === undefined) {
      return age <= this.input.unknownOwnerMaxAgeMs;
    }

    const state = await this.lookupIdentity(owner.pid);
    if (state.status === "dead") return false;
    if (state.status === "unknown") return age <= this.input.unknownOwnerMaxAgeMs;
    return this.identitiesMatch(owner.identity, state.identity);
  }

  private async retainGuardOwner(entryPath: string, entryName: string, age: number): Promise<boolean> {
    try {
      const owner = this.parseOwnerMetadata(await readFile(entryPath, "utf8"), entryName);
      return this.retainOwner(owner, age);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return false;
      throw error;
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
    const age = Date.now() - guardStat.mtimeMs;
    if (entries.length === 0) {
      if (age <= emptyGuardStaleMs) return;
    } else {
      const retainedOwners = await Promise.all(
        entries.map((entry) => this.retainGuardOwner(path.join(guardPath, entry), entry, age)),
      );
      if (retainedOwners.some(Boolean)) return;
    }

    for (const entry of entries) {
      await unlink(path.join(guardPath, entry)).catch((error: unknown) => {
        if (!isErrno(error, "ENOENT")) throw error;
      });
    }
    await rmdir(guardPath).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT") && !isErrno(error, "ENOTEMPTY")) throw error;
    });
  }

  private async acquireGuard(lockPath: string, startedAt?: number): Promise<LockGuard> {
    const guardPath = `${lockPath}.guard`;
    while (true) {
      const token = randomUUID();
      const candidatePath = `${guardPath}.${token}.pending`;
      const candidateEntryPath = path.join(candidatePath, token);
      try {
        await mkdir(candidatePath);
        try {
          await this.input.hooks?.beforeGuardPublish?.({ guardPath, candidatePath, token });
          await writeFile(candidateEntryPath, JSON.stringify(await this.createOwnerMetadata(token)), { encoding: "utf8", flag: "wx" });
          const candidateIdentity = await stat(candidatePath);
          let published = false;
          try {
            await rename(candidatePath, guardPath);
            published = true;
          } catch (error) {
            if (isErrno(error, "EEXIST") || isErrno(error, "ENOTEMPTY")) {
              await this.reclaimGuardIfAbandoned(guardPath);
            } else if (isErrno(error, "EPERM") && process.platform === "win32") {
              // Windows reports EPERM (not EEXIST/ENOTEMPTY) from rename() when the
              // destination guard directory already exists. Treat this as contention
              // only when the destination is confirmed to be an existing directory;
              // an EPERM with an absent, non-directory, or un-inspectable destination is
              // unrelated and must propagate.
              let guardIsDirectory: boolean;
              try {
                guardIsDirectory = (await stat(guardPath)).isDirectory();
              } catch {
                guardIsDirectory = false;
              }
              if (!guardIsDirectory) throw error;
              await this.reclaimGuardIfAbandoned(guardPath);
            } else {
              throw error;
            }
          }
          if (published) {
            const publishedIdentity = await stat(guardPath).catch((error: unknown) => {
              if (isErrno(error, "ENOENT")) return undefined;
              throw error;
            });
            if (
              publishedIdentity !== undefined
              && publishedIdentity.dev === candidateIdentity.dev
              && publishedIdentity.ino === candidateIdentity.ino
            ) {
              return { path: guardPath, entryPath: path.join(guardPath, token) };
            }
            await unlink(path.join(guardPath, token)).catch((error: unknown) => {
              if (!isErrno(error, "ENOENT")) throw error;
            });
            await rmdir(guardPath).catch((error: unknown) => {
              if (!isErrno(error, "ENOENT") && !isErrno(error, "ENOTEMPTY")) throw error;
            });
          }
        } catch (error) {
          throw error;
        } finally {
          await unlink(candidateEntryPath).catch((error: unknown) => {
            if (!isErrno(error, "ENOENT")) throw error;
          });
          await rmdir(candidatePath).catch((error: unknown) => {
            if (!isErrno(error, "ENOENT")) throw error;
          });
        }
      } catch (error) {
        if (isErrno(error, "EEXIST")) continue;
        throw error;
      }
      if (startedAt !== undefined && Date.now() - startedAt >= this.input.lockTimeoutMs) {
        throw this.error("Timed out waiting for run lock");
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

  private async withLockGuard<T>(lockPath: string, startedAt: number | undefined, apply: () => Promise<T>): Promise<T> {
    const guard = await this.acquireGuard(lockPath, startedAt);
    try {
      await this.input.hooks?.guardEntered?.();
      try {
        return await apply();
      } finally {
        await this.input.hooks?.guardExited?.();
      }
    } finally {
      await this.releaseGuard(guard);
    }
  }

  private async createLockWhileGuarded(lockPath: string, token: string): Promise<OwnedRunLock | undefined> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let handle;
      try {
        handle = await open(lockPath, "wx");
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
        try {
          const [lockStat, source] = await Promise.all([stat(lockPath), readFile(lockPath, "utf8")]);
          const owner = this.parseOwnerMetadata(source);
          if (await this.retainOwner(owner, Date.now() - lockStat.mtimeMs)) return undefined;
          await unlink(lockPath);
          continue;
        } catch (statError) {
          if (isErrno(statError, "ENOENT")) continue;
          throw statError;
        }
      }

      try {
        await handle.writeFile(JSON.stringify(await this.createOwnerMetadata(token)), "utf8");
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

  async acquire(runId: string): Promise<OwnedRunLock> {
    const lockPath = this.input.lockPath(runId);
    await mkdir(path.dirname(lockPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      const token = randomUUID();
      try {
        const lock = await this.withLockGuard(lockPath, startedAt, () => this.createLockWhileGuarded(lockPath, token));
        if (lock) return lock;
      } catch (error) {
        if (error instanceof Error && this.ownErrors.has(error)) throw error;
        throw this.error(`Could not acquire run lock: ${(error as Error).message}`);
      }
      if (Date.now() - startedAt >= this.input.lockTimeoutMs) {
        throw this.error("Timed out waiting for run lock");
      }
      await delay(25);
    }
  }

  async release(lock: OwnedRunLock): Promise<void> {
    try {
      // Release has no acquisition deadline: a committed rename must not surface a preservation-guaranteed timeout.
      await this.withLockGuard(lock.path, undefined, async () => {
        try {
          const source = await readFile(lock.path, "utf8");
          const owner = this.parseOwnerMetadata(source);
          if ((owner?.token ?? source) === lock.token) await unlink(lock.path);
        } catch (error) {
          if (!isErrno(error, "ENOENT")) throw error;
        }
      });
    } catch (error) {
      if (error instanceof Error && this.ownErrors.has(error)) throw error;
      throw this.error(`Could not release run lock: ${(error as Error).message}`);
    }
  }
}

export { lockTimeoutMs, staleLockMs, unknownOwnerMaxAgeMs };
