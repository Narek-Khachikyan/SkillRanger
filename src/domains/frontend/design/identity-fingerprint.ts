import { canonicalizeJson } from "../../../runtime/skill-run/validation.ts";
import type { VerifiedRunDirection } from "../../../runtime/strict/types.ts";

/**
 * Deterministic identity diversification gate.
 *
 * The gate compares a design direction's identity fingerprint — macrostructure, theme axes
 * (paper band, display style, accent hue), and the existing composition and material treatment
 * axes — against a snapshot of the last N verified run directions and requires deviation on at
 * least one dimension. Only verified runs carrying a direction participate; unverified runs are
 * excluded, and unselected candidates never constrain the certified direction.
 *
 * Snapshot semantics: at verification time the comparison set (run ids + direction digests) is
 * recorded in the gate result; replay re-checks exactly that recorded set instead of re-deriving a
 * live one, so a run completing between verify and finalize cannot flip the outcome.
 */

export const defaultDiversificationCount = 3;

export type DiversificationSnapshot = {
  runIds: string[];
  directionDigests: string[];
};

export type DesignIdentityFingerprintParts = {
  macrostructure?: string;
  themeAxes?: { paperBand?: string; displayStyle?: string; accentHue?: string };
  composition?: string;
  material?: string;
};

/** Canonical theme-axis keys shared by the direction contract, the gate, and the log. */
export const themeAxisKeys = ["paperBand", "displayStyle", "accentHue"] as const;

export type DiversificationComparison = {
  runId: string;
  directionDigest: string;
  sameFingerprint: boolean;
};

export type DiversificationGateResult = {
  passed: boolean;
  snapshot: DiversificationSnapshot;
  comparisons: DiversificationComparison[];
  sameFingerprintRunIds: string[];
  message: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalized = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export const designIdentityFingerprintParts = (direction: unknown): DesignIdentityFingerprintParts | undefined => {
  if (!isRecord(direction)) return undefined;
  const axes = isRecord(direction.axes) ? direction.axes : undefined;
  const themeAxes = isRecord(direction.themeAxes) ? direction.themeAxes : undefined;
  const parts: DesignIdentityFingerprintParts = {
    ...(normalized(direction.macrostructure) === undefined
      ? {}
      : { macrostructure: normalized(direction.macrostructure) }),
    ...(themeAxes === undefined
      ? {}
      : {
          themeAxes: {
            ...(normalized(themeAxes.paperBand) === undefined ? {} : { paperBand: normalized(themeAxes.paperBand) }),
            ...(normalized(themeAxes.displayStyle) === undefined ? {} : { displayStyle: normalized(themeAxes.displayStyle) }),
            ...(normalized(themeAxes.accentHue) === undefined ? {} : { accentHue: normalized(themeAxes.accentHue) }),
          },
        }),
    ...(axes === undefined
      ? {}
      : {
          ...(normalized(axes.composition) === undefined ? {} : { composition: normalized(axes.composition) }),
          ...(normalized(axes.material) === undefined ? {} : { material: normalized(axes.material) }),
        }),
  };
  return parts;
};

/**
 * Canonical identity fingerprint. The fixed slot order makes the fingerprint stable regardless of
 * which identity fields a direction declares, and two directions deviate on at least one dimension
 * exactly when their fingerprints differ. A direction without any comparable identity content has
 * no fingerprint (undefined) and cannot satisfy the gate.
 */
export const designIdentityFingerprint = (direction: unknown): string | undefined => {
  const parts = designIdentityFingerprintParts(direction);
  if (!parts) return undefined;
  return JSON.stringify([
    "identity-fingerprint",
    parts.macrostructure ?? "",
    parts.themeAxes?.paperBand ?? "",
    parts.themeAxes?.displayStyle ?? "",
    parts.themeAxes?.accentHue ?? "",
    parts.composition ?? "",
    parts.material ?? "",
  ]);
};

export const serializeDiversificationMessage = (input: {
  passed: boolean;
  snapshot: DiversificationSnapshot;
  sameFingerprintRunIds: string[];
}): string => canonicalizeJson({
  gate: "identity-diversification",
  ...input,
});

export const parseDiversificationMessage = (message: string): {
  passed: boolean;
  snapshot: DiversificationSnapshot;
  sameFingerprintRunIds: string[];
} | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.gate !== "identity-diversification") return undefined;
  if (typeof parsed.passed !== "boolean" || !Array.isArray(parsed.sameFingerprintRunIds)) return undefined;
  const snapshot = isRecord(parsed.snapshot) ? parsed.snapshot : undefined;
  if (!snapshot || !Array.isArray(snapshot.runIds) || !Array.isArray(snapshot.directionDigests)) return undefined;
  if (snapshot.runIds.length !== snapshot.directionDigests.length) return undefined;
  if (!snapshot.runIds.every((id): id is string => typeof id === "string")
    || !snapshot.directionDigests.every((digest): digest is string => typeof digest === "string")) {
    return undefined;
  }
  return {
    passed: parsed.passed,
    snapshot: { runIds: snapshot.runIds, directionDigests: snapshot.directionDigests },
    sameFingerprintRunIds: parsed.sameFingerprintRunIds.filter((id): id is string => typeof id === "string"),
  };
};

const driftFailure = (message: string): DiversificationGateResult => ({
  passed: false,
  snapshot: { runIds: [], directionDigests: [] },
  comparisons: [],
  sameFingerprintRunIds: [],
  message: canonicalizeJson({ gate: "identity-diversification", passed: false, drift: message }),
});

export const evaluateDiversificationGate = (input: {
  direction: unknown;
  verifiedRuns: readonly VerifiedRunDirection[];
  count: number;
  recordedSnapshot?: DiversificationSnapshot;
}): DiversificationGateResult => {
  const fingerprint = designIdentityFingerprint(input.direction);
  if (fingerprint === undefined) {
    return {
      passed: false,
      snapshot: { runIds: [], directionDigests: [] },
      comparisons: [],
      sameFingerprintRunIds: [],
      message: canonicalizeJson({
        gate: "identity-diversification",
        passed: false,
        reason: "no-direction-fingerprint",
      }),
    };
  }

  let compared: VerifiedRunDirection[];
  if (input.recordedSnapshot !== undefined) {
    const byRunId = new Map(input.verifiedRuns.map((run) => [run.runId, run]));
    const recorded = input.recordedSnapshot;
    for (const [index, runId] of recorded.runIds.entries()) {
      const run = byRunId.get(runId);
      if (run === undefined) {
        return driftFailure(`recorded verified run ${runId} is no longer present.`);
      }
      if (run.directionDigest !== recorded.directionDigests[index]) {
        return driftFailure(`recorded direction digest for ${runId} changed.`);
      }
    }
    compared = recorded.runIds.map((runId) => byRunId.get(runId)!);
  } else {
    const count = Number.isInteger(input.count) && input.count >= 1 ? input.count : defaultDiversificationCount;
    compared = input.verifiedRuns.slice(0, count);
  }

  const comparisons: DiversificationComparison[] = compared.map((run) => ({
    runId: run.runId,
    directionDigest: run.directionDigest,
    sameFingerprint: designIdentityFingerprint(run.direction) === fingerprint,
  }));
  const sameFingerprintRunIds = comparisons
    .filter((comparison) => comparison.sameFingerprint)
    .map((comparison) => comparison.runId);
  const snapshot: DiversificationSnapshot = {
    runIds: compared.map((run) => run.runId),
    directionDigests: compared.map((run) => run.directionDigest),
  };
  return {
    passed: sameFingerprintRunIds.length === 0,
    snapshot,
    comparisons,
    sameFingerprintRunIds,
    message: serializeDiversificationMessage({ passed: sameFingerprintRunIds.length === 0, snapshot, sameFingerprintRunIds }),
  };
};
