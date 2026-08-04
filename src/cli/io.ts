import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(path.resolve(file), "utf8")) as T;

export const isContained = (root: string, candidate: string) =>
  candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);

/** Resolve an existing path, or the first existing ancestor plus its missing tail. */
export const canonicalPath = async (target: string): Promise<string> => {
  const resolved = path.resolve(target);
  let cursor = resolved;
  const suffix: string[] = [];
  while (!(await lstat(cursor).catch(() => undefined))) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const canonicalParent = await realpath(cursor).catch(() => cursor);
  return path.join(canonicalParent, ...suffix);
};
