import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assertFinalizedVerified } from "../../../runtime/strict/finalization.ts";
import type { SkillRunV2, VerifiedRunDirection } from "../../../runtime/strict/types.ts";
import {
  defaultDiversificationCount,
  designIdentityFingerprintParts,
  themeAxisKeys,
  type DesignIdentityFingerprintParts,
} from "./identity-fingerprint.ts";

/**
 * Project-scoped diversification log.
 *
 * `.design/diversification-log.json` is a derived cache written by tooling from verified run
 * facts — the run store's verified-runs enumeration, never the model — for the model's in-session
 * awareness during a build. It records the identity fingerprint of the most recent verified run
 * directions, capped at the diversification gate's snapshot window, so the design skill can avoid
 * repeating the identity dimensions that would actually fail the gate. The log is explicitly not
 * the enforcement mechanism: only the deterministic identity-diversification gate decides, and the
 * log may be missing, stale, or edited without changing any gate outcome.
 */

export const diversificationLogFileName = "diversification-log.json";

export const diversificationLogDirectory = ".design";

export const diversificationLogPath = (projectRoot: string) =>
  path.join(projectRoot, diversificationLogDirectory, diversificationLogFileName);

export type DiversificationLogEntry = {
  runId: string;
  updatedAt: string;
  directionDigest: string;
  identity?: DesignIdentityFingerprintParts;
};

export type DiversificationLog = {
  schemaVersion: "1.0";
  kind: "frontend-diversification-log";
  derivedAt: string;
  source: "verified-run-facts";
  entries: DiversificationLogEntry[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * Pure derivation from verified run facts, newest first by run update time. Entries are capped at
 * the gate's default snapshot count so the awareness cache never reports identities outside the
 * window that can actually fail the gate. Entries for directions without identity content carry no
 * identity field; the run id and direction digest are preserved verbatim so a stale log can be
 * cross-checked against the run store.
 */
export const deriveDiversificationLog = (
  verifiedRuns: readonly VerifiedRunDirection[],
  derivedAt: string,
  count = defaultDiversificationCount,
): DiversificationLog => {
  const entries: DiversificationLogEntry[] = [...verifiedRuns]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Number.isInteger(count) && count >= 1 ? count : defaultDiversificationCount)
    .map((run) => {
      const identity = designIdentityFingerprintParts(run.direction);
      return {
        runId: run.runId,
        updatedAt: run.updatedAt,
        directionDigest: run.directionDigest,
        ...(identity === undefined ? {} : { identity }),
      };
    });
  return {
    schemaVersion: "1.0",
    kind: "frontend-diversification-log",
    derivedAt,
    source: "verified-run-facts",
    entries,
  };
};

const entryKeys = ["runId", "updatedAt", "directionDigest", "identity"] as const;
const identityKeys = ["macrostructure", "themeAxes", "composition", "material"] as const;

/**
 * An identity object is canonical exactly when the fingerprint extractor reproduces it from the
 * identity's own parts. The extractor reads the direction shape (composition/material under axes),
 * so a synthetic direction bridges the parts shape; foreign keys are rejected up front because the
 * extractor would silently ignore them.
 */
const canonicalIdentity = (value: unknown): DesignIdentityFingerprintParts | undefined => {
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).some((key) => !identityKeys.includes(key as (typeof identityKeys)[number]))) return undefined;
  if (value.themeAxes !== undefined) {
    if (!isRecord(value.themeAxes)) return undefined;
    if (Object.keys(value.themeAxes).some((key) => !themeAxisKeys.includes(key as (typeof themeAxisKeys)[number]))) return undefined;
    if (Object.values(value.themeAxes).every((entry) => !isNonEmptyString(entry))) return undefined;
  }
  const parts = designIdentityFingerprintParts({
    ...(value.macrostructure === undefined ? {} : { macrostructure: value.macrostructure }),
    ...(value.themeAxes === undefined ? {} : { themeAxes: value.themeAxes }),
    axes: {
      ...(value.composition === undefined ? {} : { composition: value.composition }),
      ...(value.material === undefined ? {} : { material: value.material }),
    },
  });
  if (parts === undefined) return undefined;
  return JSON.stringify(parts) === JSON.stringify(value) ? parts : undefined;
};

export const validateDiversificationLog = (value: unknown, at = "diversification log"): DiversificationLog => {
  if (!isRecord(value)) throw new Error(`Invalid ${at}: expected an object.`);
  if (value.schemaVersion !== "1.0") throw new Error(`${at} schemaVersion must be 1.0.`);
  if (value.kind !== "frontend-diversification-log") {
    throw new Error(`${at} kind must be frontend-diversification-log.`);
  }
  if (!isNonEmptyString(value.derivedAt)) throw new Error(`${at} requires a non-empty derivedAt.`);
  if (value.source !== "verified-run-facts") throw new Error(`${at} source must be verified-run-facts.`);
  if (!Array.isArray(value.entries)) throw new Error(`${at} entries must be an array.`);
  const entries: DiversificationLogEntry[] = value.entries.map((entry, index) => {
    const atEntry = `${at}.entries[${index}]`;
    if (!isRecord(entry)) throw new Error(`${atEntry} must be an object.`);
    if (!isNonEmptyString(entry.runId) || !isNonEmptyString(entry.updatedAt) || !isNonEmptyString(entry.directionDigest)) {
      throw new Error(`${atEntry} requires non-empty runId, updatedAt, and directionDigest.`);
    }
    if (Object.keys(entry).some((key) => !entryKeys.includes(key as (typeof entryKeys)[number]))) {
      throw new Error(`${atEntry} carries an unknown field.`);
    }
    const identity = entry.identity === undefined ? undefined : canonicalIdentity(entry.identity);
    if (entry.identity !== undefined && identity === undefined) {
      throw new Error(`${atEntry}.identity is not a canonical identity fingerprint.`);
    }
    return {
      runId: entry.runId,
      updatedAt: entry.updatedAt,
      directionDigest: entry.directionDigest,
      ...(identity === undefined ? {} : { identity }),
    };
  });
  return {
    schemaVersion: "1.0",
    kind: "frontend-diversification-log",
    derivedAt: value.derivedAt,
    source: "verified-run-facts",
    entries,
  };
};

/**
 * Reads the cache as the model's build would: absent, unreadable, or structurally invalid content
 * degrades to undefined (a cache is only as good as its next refresh), so a stale or corrupt log
 * never breaks a build. Callers that need strict validation use validateDiversificationLog.
 */
export const readDiversificationLog = async (projectRoot: string): Promise<DiversificationLog | undefined> => {
  let raw: string;
  try {
    raw = await readFile(diversificationLogPath(projectRoot), "utf8");
  } catch {
    return undefined;
  }
  try {
    return validateDiversificationLog(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

export const writeDiversificationLog = async (projectRoot: string, log: DiversificationLog): Promise<string> => {
  const target = diversificationLogPath(projectRoot);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(log, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return target;
};

/**
 * Tooling entrypoint: derive the log from the store's verified-run facts and write it atomically.
 * Hosts call this after a strict run finalizes as verified, so the cache always reflects the same
 * comparison window the diversification gate uses.
 */
export const refreshDiversificationLog = async (
  projectRoot: string,
  verifiedRuns: readonly VerifiedRunDirection[],
  derivedAt = new Date().toISOString(),
): Promise<DiversificationLog> => {
  const log = deriveDiversificationLog(verifiedRuns, derivedAt);
  await writeDiversificationLog(projectRoot, log);
  return log;
};

/**
 * Shared by the MCP and CLI finalize surfaces so they cannot disagree about the tooling step that
 * follows a certified finalize. The refresh is best-effort: an already-verified run must not be
 * reported as failed because a derived cache write failed — the next verified finalize overwrites
 * the log.
 */
export const finalizeStrictRunRefreshingDiversificationLog = async (
  projectRoot: string,
  store: {
    finalizeRun(runId: string): Promise<SkillRunV2>;
    listVerifiedRuns(): Promise<VerifiedRunDirection[]>;
  },
  runId: string,
): Promise<SkillRunV2> => {
  const run = assertFinalizedVerified(await store.finalizeRun(runId));
  if (run.domain === "frontend") {
    try {
      await refreshDiversificationLog(projectRoot, await store.listVerifiedRuns());
    } catch {
      // Best-effort cache refresh; the finalized run result is authoritative.
    }
  }
  return run;
};
