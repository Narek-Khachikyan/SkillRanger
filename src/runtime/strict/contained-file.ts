import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";

export type ContainedFileReadPhase = "ingestion" | "verification";

type AfterReadHook = (target: string) => void | Promise<void>;

// Internal deterministic race seam. It is intentionally absent from strict/index.ts.
export const internalContainedFileReadHooks: Partial<Record<ContainedFileReadPhase, AfterReadHook>> = {};

export class ContainedFileReadError extends Error {}

const containedBy = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const sameIdentity = (left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }) =>
  left.dev === right.dev && left.ino === right.ino;

export const readContainedFile = async (input: {
  projectRoot: string;
  canonicalRoot?: string;
  target: string;
  phase: ContainedFileReadPhase;
}) => {
  let handle: FileHandle | undefined;
  try {
    const [canonicalRoot, leaf] = await Promise.all([
      input.canonicalRoot === undefined ? realpath(input.projectRoot) : input.canonicalRoot,
      lstat(input.target),
    ]);
    if (!leaf.isFile() || leaf.isSymbolicLink()) {
      throw new ContainedFileReadError("Contained source must be a real file, not a symlink.");
    }
    const canonicalBeforeOpen = await realpath(input.target);
    if (!containedBy(canonicalRoot, canonicalBeforeOpen)) {
      throw new ContainedFileReadError("Contained source must stay inside the project root.");
    }
    handle = await open(input.target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    const bytes = await handle.readFile();
    try { await internalContainedFileReadHooks[input.phase]?.(input.target); }
    catch { /* Test instrumentation cannot alter a successful read directly. */ }
    const [leafAfterRead, canonicalAfterRead] = await Promise.all([lstat(input.target), realpath(input.target)]);
    if (canonicalAfterRead !== canonicalBeforeOpen || !containedBy(canonicalRoot, canonicalAfterRead)) {
      throw new ContainedFileReadError("Contained source changed containment while it was read.");
    }
    if (
      !info.isFile()
      || !leafAfterRead.isFile()
      || leafAfterRead.isSymbolicLink()
      || !sameIdentity(leaf, info)
      || !sameIdentity(info, leafAfterRead)
      || info.size !== bytes.byteLength
    ) {
      throw new ContainedFileReadError("Contained source changed while it was read.");
    }
    return { bytes, stat: info };
  } catch (error) {
    if (error instanceof ContainedFileReadError) throw error;
    throw new ContainedFileReadError("Contained source could not be read securely.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
};
