export const designRuleFamilies = [
  "typography", "layout", "responsive", "color", "state", "signature-move",
] as const;

export type DesignRuleFamily = (typeof designRuleFamilies)[number];

// These identifiers are the compatibility boundary for the bundled 0.5.1 corpus.
// A new identifier is an explicit corpus change, not an incidental loader extension.
export const designRuleIds = [
  "typography.role-contrast",
  "typography.editorial-product",
  "typography.dense-workspace",
  "layout.action-evidence",
  "layout.list-detail",
  "layout.commerce-comparison",
  "responsive.recompose-not-stack",
  "responsive.list-detail-drill-in",
  "responsive.mobile-thumb-zone",
  "color.semantic-roles",
  "color.commerce-trust",
  "color.operational-status",
  "state.complete-primary-flow",
  "state.recovery-first",
  "state.optimistic-offline",
  "signature.product-data-grammar",
  "signature.conversion-proof",
  "signature.repeated-action-feedback",
] as const;

export type DesignRuleId = (typeof designRuleIds)[number];

export type DesignRuleNormativeBaseline = {
  readonly version: string;
  readonly digest: string;
};

// The baseline is intentionally separate from rule prose and provenance. Updating a
// normative field therefore requires both a semantic version bump and an explicit
// compatibility-baseline update.
const freezeNormativeBaselines = <T extends Record<string, DesignRuleNormativeBaseline>>(baselines: T) => {
  for (const baseline of Object.values(baselines)) Object.freeze(baseline);
  return Object.freeze(baselines);
};

export const designRuleNormativeBaselines = freezeNormativeBaselines({
  "typography.role-contrast": { version: "1.0.0", digest: "51718aa0721a77697c52bd8115ff873e90ca0e379b68b42b66bd02e30859a0bc" },
  "typography.editorial-product": { version: "1.0.0", digest: "1b3b793d4876339579561553e5f20069871ef3a9e174a19512f087bfbb16d4db" },
  "typography.dense-workspace": { version: "1.0.0", digest: "916a16d665db20383e513444dbfc82074b26e9248a205a36be3a7e689b186883" },
  "layout.action-evidence": { version: "1.0.0", digest: "4180503c2e60a395ee24a9f771af6938369b9e6c3af5c2f4b5da42834023bec8" },
  "layout.list-detail": { version: "1.0.0", digest: "963aee1ede9542303c0ee07004be1c660269c59202b0826c85c40c5bad255758" },
  "layout.commerce-comparison": { version: "1.0.0", digest: "05f3e243aa6d48a2899840352b1512a404fd01cc828979c3ff6f9ee4e84280a2" },
  "responsive.recompose-not-stack": { version: "1.0.0", digest: "73633de5bb058612093836e73bd225d09a41be439a865b2ff386dd54164ef150" },
  "responsive.list-detail-drill-in": { version: "1.0.0", digest: "9443ae13fd9287aae0b69cf0cd73661aca214ca1992d9368c71c7d213436775e" },
  "responsive.mobile-thumb-zone": { version: "1.0.0", digest: "c43f299b79fe85904a73e792c6986adcb42971190370ddaefafdcd53c2bb915d" },
  "color.semantic-roles": { version: "1.0.0", digest: "61f101c5bc287346539b13c6c161b592a53d2a7a7470e1e084af2d2a7844dd6e" },
  "color.commerce-trust": { version: "1.0.0", digest: "178902539943502f669566d34332540f17cceeda36e11c71e15f6cb920c9fb2a" },
  "color.operational-status": { version: "1.0.0", digest: "c962d321383d7e1374403eded0635f09b84c46099bfcc30bfa274645e6c8e7f5" },
  "state.complete-primary-flow": { version: "1.0.0", digest: "35d5b1956f8e29ff1ec136629cc2bbaedfdc919ec7c98d4f32e782c28b06dc43" },
  "state.recovery-first": { version: "1.0.0", digest: "d3992759a5fcc57b84efd331effbfd80eb64e496289c010b5ba4140b97d67eab" },
  "state.optimistic-offline": { version: "1.0.0", digest: "37e4cac6a7f628435f2a68b6297dd87150ea7ab654b66b034106ecbef0e96edc" },
  "signature.product-data-grammar": { version: "1.0.0", digest: "dc02ceb2eff8cb8542d92bbf58522d39a975c03939530af7fee9f0375f0b58dd" },
  "signature.conversion-proof": { version: "1.0.0", digest: "f03db0e068849dac1549f9c370374f1e9a243ea52b3a19e543919ee9b822009e" },
  "signature.repeated-action-feedback": { version: "1.0.0", digest: "fb4b7d59b236ff25c1f28e10fffe252f409b0f538de5e3cd04d6d65007ce0445" },
} as const) satisfies Readonly<Record<DesignRuleId, DesignRuleNormativeBaseline>>;

export const designRuleEvidenceStatuses = [
  "observed", "inferred", "assumed", "unknown",
] as const;

export type DesignRuleEvidenceStatus = (typeof designRuleEvidenceStatuses)[number];

export type DesignRuleProvenance = {
  /** A source URL or a stable SkillRanger source identifier. */
  source: string;
  /** The page, route, or document state when it is known. */
  page?: string;
  /** The public UI state when it is known. */
  state?: string;
  /** Stable product identity used to distinguish cross-product recurrence from two extractors of one product. */
  productId?: string;
  /** The date a curator reviewed the normalized observation. */
  reviewedAt?: string;
  /** The date the source observation was captured, when it is known. */
  capturedAt?: string;
  /** The reproducible way the source observation was obtained. */
  extractionMethod: string;
  /** The source format/schema retained for audit, never imported as the rule contract. */
  extractionSchema: string;
  /** The epistemic status of the observation before normalization. */
  evidenceStatus: DesignRuleEvidenceStatus;
};

export type DesignRule = {
  schemaVersion: "1.1";
  id: string;
  version: string;
  family: DesignRuleFamily;
  name: string;
  recipeIds: string[];
  preconditions: string[];
  intent: string;
  constraints: string[];
  rolesConsumed: string[];
  responsiveBehavior: string[];
  accessibility: string[];
  antiPatterns: string[];
  verification: string[];
  provenance: DesignRuleProvenance[];
};

export type DesignRuleIndex = {
  schemaVersion: "1.0";
  files: Record<DesignRuleFamily, string>;
};

export type DesignRuleLibrary = {
  index: DesignRuleIndex;
  rules: DesignRule[];
};
