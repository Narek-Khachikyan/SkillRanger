import type { VerificationFinding } from "../../../runtime/types.ts";

// The DNA-extraction artifact is the reference-handling skill's structured output: a
// provenance-labelled record of the reference design's macrostructure, type pairing, and
// colour anchor as named attributes. The attribute-vs-trade-dress boundary is structural:
// the artifact records attributes (named composition shapes, voice roles, hue families)
// and must refuse protected expression (exact tokens, brand marks, trade-dress
// reproduction). Pixel-clone refusal is a hard gate: exact color literals and embedded
// pixel data are rejected outright.

export type ReferenceDnaOwnership =
  | "user-owned"
  | "product-local"
  | "competitor-inspiration"
  | "unknown";

export type ReferenceDnaReference = {
  source: string;
  kind: "screenshot" | "mock" | "figma-brief" | "design-spec";
  ownership: ReferenceDnaOwnership;
};

export type ReferenceDnaArtifact = {
  schemaVersion: "1.0";
  reference: ReferenceDnaReference;
  macrostructure: { name: string; evidence: string };
  typePairing: { displayVoice: string; bodyVoice: string; evidence: string };
  colourAnchor: { paperBand: string; displayStyle: string; accentHue: string; evidence: string };
  evidence: {
    observed: Array<{ statement: string; source?: string }>;
    inferred: Array<{ statement: string; source?: string }>;
    assumed: Array<{ statement: string; source?: string }>;
    unknown: Array<{ statement: string; source?: string }>;
  };
  boundary: {
    attributesExtracted: string[];
    protectedExpressionRefused: string[];
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const dnaKeys = [
  "schemaVersion",
  "reference",
  "macrostructure",
  "typePairing",
  "colourAnchor",
  "evidence",
  "boundary",
] as const;
const referenceKeys = ["source", "kind", "ownership"] as const;
const attributeKeys = ["name", "displayVoice", "bodyVoice", "paperBand", "displayStyle", "accentHue", "evidence"] as const;
const evidenceKeys = ["observed", "inferred", "assumed", "unknown"] as const;
const boundaryKeys = ["attributesExtracted", "protectedExpressionRefused"] as const;
const ownershipClasses: ReferenceDnaOwnership[] = [
  "user-owned",
  "product-local",
  "competitor-inspiration",
  "unknown",
];
const referenceKinds = ["screenshot", "mock", "figma-brief", "design-spec"] as const;

const finding = (
  code: string,
  severity: VerificationFinding["severity"],
  gate: VerificationFinding["gate"],
  message: string,
  remediation: string,
  evidence: string[] = [],
): VerificationFinding => ({
  id: code,
  code,
  source: "frontend.dna-validator",
  severity,
  gate,
  message,
  evidence,
  remediation,
  autofixable: false,
});

const evidenceLadderFinding = (value: unknown, at: string): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  if (!isRecord(value) || !hasOnlyKeys(value, evidenceKeys) || !evidenceKeys.every((key) => Array.isArray(value[key]))) {
    return [finding(
      "dna-evidence-ledger",
      "critical",
      "hard",
      "DNA artifact evidence must be separated into observed, inferred, assumed, and unknown arrays.",
      "Record every DNA claim in exactly one evidence category; move each entry between categories instead of duplicating.",
    )];
  }
  for (const key of evidenceKeys) {
    for (const [index, entry] of (value[key] as unknown[]).entries()) {
      if (
        !isRecord(entry) ||
        !hasOnlyKeys(entry, ["statement", "source"]) ||
        !isNonEmptyString(entry.statement) ||
        (entry.source !== undefined && typeof entry.source !== "string")
      ) {
        findings.push(finding(
          "dna-evidence-entry-contract",
          "critical",
          "hard",
          `DNA evidence entry ${at}.${key}[${index}] must carry a non-empty statement and an optional string source.`,
          "Regenerate the evidence entry against the reference-dna schema.",
        ));
      }
    }
  }
  return findings;
};

// Exact color literals and embedded pixel data are the pixel-clone line. The artifact
// records named attributes ("warm sand", "signal teal"), never reference tokens.
const pixelClonePatterns = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\boklch\(/i,
  /\brgb(?:a)?\(/i,
  /\bhsl(?:a)?\(/i,
  /\bhwb\(/i,
  /data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,/i,
];

export const containsPixelClone = (value: string): boolean =>
  pixelClonePatterns.some((pattern) => pattern.test(value));

const attributeStringValues = (artifact: unknown): string[] => {
  if (!isRecord(artifact)) return [];
  const values: string[] = [];
  for (const section of ["macrostructure", "typePairing", "colourAnchor"] as const) {
    const record = isRecord(artifact[section]) ? artifact[section] : undefined;
    if (!record) continue;
    for (const key of Object.keys(record)) {
      if (typeof record[key] === "string") values.push(record[key] as string);
    }
  }
  return values;
};

export const validateReferenceDna = (value: unknown): VerificationFinding[] => {
  const findings: VerificationFinding[] = [];
  if (!isRecord(value) || value.schemaVersion !== "1.0") {
    return [finding(
      "dna-schema-version",
      "critical",
      "hard",
      "DNA artifact schemaVersion must be 1.0.",
      "Regenerate the artifact with schemaVersion 1.0.",
    )];
  }
  if (!isRecord(value) || !hasOnlyKeys(value, dnaKeys)) {
    findings.push(finding(
      "dna-structure-contract",
      "critical",
      "hard",
      "DNA artifact must contain only the canonical reference, macrostructure, typePairing, colourAnchor, evidence, and boundary objects.",
      "Regenerate the artifact from the canonical reference-dna schema.",
    ));
  }

  const reference = isRecord(value.reference) ? value.reference : undefined;
  if (
    !reference ||
    !hasOnlyKeys(reference, referenceKeys) ||
    !isNonEmptyString(reference.source) ||
    !referenceKinds.includes(reference.kind as never) ||
    !ownershipClasses.includes(reference.ownership as never)
  ) {
    findings.push(finding(
      "dna-reference-contract",
      "critical",
      "hard",
      "DNA artifact reference must declare a non-empty source, a supported kind, and a classified ownership.",
      "Record the reference source, kind (screenshot, mock, figma-brief, design-spec), and ownership class (user-owned, product-local, competitor-inspiration, unknown).",
    ));
  }

  const attributeSections = ["macrostructure", "typePairing", "colourAnchor"] as const;
  const requiredAttributeFields: Record<(typeof attributeSections)[number], string[]> = {
    macrostructure: ["name", "evidence"],
    typePairing: ["displayVoice", "bodyVoice", "evidence"],
    colourAnchor: ["paperBand", "displayStyle", "accentHue", "evidence"],
  };
  for (const section of attributeSections) {
    const record = isRecord(value[section]) ? value[section] : undefined;
    const required = requiredAttributeFields[section];
    if (
      !record ||
      !hasOnlyKeys(record, attributeKeys) ||
      !required.every((key) => isNonEmptyString(record[key]))
    ) {
      findings.push(finding(
        "dna-attribute-contract",
        "critical",
        "hard",
        `DNA artifact ${section} must declare ${required.join(", ")} as non-empty strings.`,
        "Record the extracted attribute for each required field; use \"unknown\" only with an explicit evidence note.",
      ));
    }
  }

  findings.push(...evidenceLadderFinding(value.evidence, "evidence"));

  const boundary = isRecord(value.boundary) ? value.boundary : undefined;
  const attributesExtracted = Array.isArray(boundary?.attributesExtracted) ? boundary.attributesExtracted : undefined;
  const protectedExpressionRefused = Array.isArray(boundary?.protectedExpressionRefused)
    ? boundary.protectedExpressionRefused
    : undefined;
  if (
    !boundary ||
    !hasOnlyKeys(boundary, boundaryKeys) ||
    !Array.isArray(attributesExtracted) ||
    attributesExtracted.length === 0 ||
    !attributesExtracted.every(isNonEmptyString) ||
    !Array.isArray(protectedExpressionRefused) ||
    !protectedExpressionRefused.every(isNonEmptyString)
  ) {
    findings.push(finding(
      "dna-boundary-contract",
      "critical",
      "hard",
      "DNA artifact boundary must declare non-empty attributesExtracted and an array of protectedExpressionRefused entries.",
      "Record the attributes you extracted and the protected expression you refused to copy.",
    ));
  }

  // High-risk sources must record what protected expression was refused: the artifact
  // proves the trade-dress boundary by naming the refusal, not merely by being silent.
  const ownership = reference?.ownership;
  if (
    (ownership === "competitor-inspiration" || ownership === "unknown") &&
    protectedExpressionRefused !== undefined &&
    protectedExpressionRefused.length === 0
  ) {
    findings.push(finding(
      "dna-trade-dress-refusal",
      "high",
      "hard",
      "A competitor or unknown-source DNA artifact must record at least one protected expression it refused (logo, exact palette-plus-layout, mascot, hero composition, trade-dress impression).",
      "Name the protected expression you intentionally did not extract before using the artifact in a build.",
    ));
  }

  const clonedAttributes = attributeStringValues(value).filter(containsPixelClone);
  if (clonedAttributes.length > 0) {
    findings.push(finding(
      "dna-pixel-clone-refused",
      "critical",
      "hard",
      "DNA artifact attributes must be named attributes, not exact reference tokens: exact color literals and embedded pixel data are refused.",
      "Replace exact color literals (hex, oklch(), rgb(), hsl(), hwb()) and base64 image data with named attributes such as hue families and paper bands.",
      clonedAttributes,
    ));
  }
  return findings;
};

export const isHighRiskReferenceOwnership = (ownership: ReferenceDnaOwnership): boolean =>
  ownership === "competitor-inspiration" || ownership === "unknown";

export const asReferenceDnaArtifact = (value: unknown): ReferenceDnaArtifact | undefined => {
  if (!isRecord(value) || value.schemaVersion !== "1.0") return undefined;
  return validateReferenceDna(value).length === 0 ? (value as ReferenceDnaArtifact) : undefined;
};
