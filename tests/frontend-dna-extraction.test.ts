import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  asReferenceDnaArtifact,
  containsPixelClone,
  isHighRiskReferenceOwnership,
  validateReferenceDna,
  type ReferenceDnaArtifact,
} from "../src/domains/frontend/design/dna-extraction.ts";
import { validateJsonSchema } from "../src/runtime/strict/json-schema.ts";

const makeDna = (): ReferenceDnaArtifact => ({
  schemaVersion: "1.0",
  reference: {
    source: "fixtures/reference/analytics-console.png",
    kind: "screenshot",
    ownership: "competitor-inspiration",
  },
  macrostructure: {
    name: "Evidence-First List",
    evidence: "The page opens with a compact title row followed by a dense scannable list; no hero band.",
  },
  typePairing: {
    displayVoice: "geometric grotesque",
    bodyVoice: "humanist sans",
    evidence: "Headlines and numerals use a closed-aperture grotesque; body copy stays humanist.",
  },
  colourAnchor: {
    paperBand: "cool graphite",
    displayStyle: "technical grotesque",
    accentHue: "signal teal",
    evidence: "The canvas is near-achromatic cool; one teal accent carries the interactive voice.",
  },
  evidence: {
    observed: [
      { statement: "List rows carry the primary facts; actions live on rows.", source: "fixtures/reference/analytics-console.png" },
    ],
    inferred: [{ statement: "The identity registers as a technical console rather than a marketing surface." }],
    assumed: [],
    unknown: [{ statement: "Exact token values and the reference's own typeface names are not recorded." }],
  },
  boundary: {
    attributesExtracted: ["evidence-first composition shape", "grotesque display + humanist body pairing", "cool graphite paper band", "single teal accent"],
    protectedExpressionRefused: ["logo", "exact palette-plus-layout", "mascot"],
  },
});

test("DNA artifact schema accepts a valid provenance-labelled artifact", async () => {
  const schema = JSON.parse(await readFile(path.resolve("domains/frontend/schemas/reference-dna.schema.json"), "utf8"));
  assert.equal(schema.$id, "https://skillranger.local/domains/frontend/reference-dna.schema.json");
  const dna = makeDna();
  assert.deepEqual(validateJsonSchema(schema, dna), []);
  assert.deepEqual(validateReferenceDna(dna), []);
  assert.deepEqual(asReferenceDnaArtifact(dna), dna);
});

test("DNA artifact schema rejects malformed artifacts", async () => {
  const schema = JSON.parse(await readFile(path.resolve("domains/frontend/schemas/reference-dna.schema.json"), "utf8"));
  const dna = makeDna();

  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, schemaVersion: "1.1" }), []);
  assert.notDeepEqual(validateReferenceDna({ ...dna, schemaVersion: "1.1" }), []);

  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, reference: { ...dna.reference, ownership: "brand-copy" } }), []);
  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, reference: { ...dna.reference, kind: "video" } }), []);
  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, reference: { ...dna.reference, source: "  " } }), []);

  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, macrostructure: { name: "Hero-Forward" } }), []);
  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, typePairing: { displayVoice: "x" } }), []);
  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, colourAnchor: { paperBand: "warm sand" } }), []);

  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, boundary: { attributesExtracted: [] } }), []);
  assert.notDeepEqual(validateJsonSchema(schema, { ...dna, extraField: true }), []);

  const noEvidence = { ...dna, evidence: { observed: [], inferred: [], assumed: [] } };
  assert.notDeepEqual(validateJsonSchema(schema, noEvidence), []);
  assert.ok(validateReferenceDna(noEvidence).some(({ code }) => code === "dna-evidence-ledger"));
});

test("DNA validator rejects attribute sections with missing or empty fields", () => {
  const dna = makeDna();
  const emptyName = { ...dna, macrostructure: { name: "  ", evidence: "observed" } };
  assert.ok(validateReferenceDna(emptyName).some(({ code }) => code === "dna-attribute-contract"));

  const missingBody = { ...dna, typePairing: { displayVoice: "geometric", evidence: "observed" } };
  assert.ok(validateReferenceDna(missingBody).some(({ code }) => code === "dna-attribute-contract"));

  const missingAccent = { ...dna, colourAnchor: { paperBand: "warm sand", displayStyle: "rounded", evidence: "observed" } };
  assert.ok(validateReferenceDna(missingAccent).some(({ code }) => code === "dna-attribute-contract"));
});

test("DNA validator rejects malformed evidence entries", () => {
  const dna = makeDna();
  const badStatement = {
    ...dna,
    evidence: { ...dna.evidence, observed: [{ statement: "  " }] },
  };
  assert.ok(validateReferenceDna(badStatement).some(({ code }) => code === "dna-evidence-entry-contract"));

  const badShape = {
    ...dna,
    evidence: { ...dna.evidence, inferred: [{ nope: true }] },
  };
  assert.ok(validateReferenceDna(badShape).some(({ code }) => code === "dna-evidence-entry-contract"));
});

test("trade-dress boundary: attributes are extractable for every ownership class", () => {
  for (const ownership of ["user-owned", "product-local", "competitor-inspiration", "unknown"] as const) {
    const dna = { ...makeDna(), reference: { ...makeDna().reference, ownership } };
    const findings = validateReferenceDna(dna);
    assert.equal(findings.some(({ code }) => code === "dna-trade-dress-refusal"), false, ownership);
  }
  assert.equal(isHighRiskReferenceOwnership("user-owned"), false);
  assert.equal(isHighRiskReferenceOwnership("competitor-inspiration"), true);
  assert.equal(isHighRiskReferenceOwnership("unknown"), true);
});

test("trade-dress boundary: protected expression refusal is required for high-risk sources", () => {
  const dna = makeDna();
  const silentCompetitor = {
    ...dna,
    boundary: { ...dna.boundary, protectedExpressionRefused: [] },
  };
  const findings = validateReferenceDna(silentCompetitor);
  assert.ok(findings.some(({ code, gate, severity }) =>
    code === "dna-trade-dress-refusal" && gate === "hard" && severity === "high",
  ));

  const silentUnknown = {
    ...makeDna(),
    reference: { ...dna.reference, ownership: "unknown" },
    boundary: { ...dna.boundary, protectedExpressionRefused: [] },
  };
  assert.ok(validateReferenceDna(silentUnknown).some(({ code }) => code === "dna-trade-dress-refusal"));

  const silentUserOwned = {
    ...makeDna(),
    reference: { ...dna.reference, ownership: "user-owned" },
    boundary: { ...dna.boundary, protectedExpressionRefused: [] },
  };
  assert.equal(validateReferenceDna(silentUserOwned).some(({ code }) => code === "dna-trade-dress-refusal"), false);
});

test("pixel-clone refusal: exact color literals and embedded pixel data are rejected", () => {
  assert.equal(containsPixelClone("signal teal"), false);
  assert.equal(containsPixelClone("warm sand"), false);
  assert.equal(containsPixelClone("#0e7490"), true);
  assert.equal(containsPixelClone("oklch(0.56 0.14 190)"), true);
  assert.equal(containsPixelClone("rgb(14 116 144)"), true);
  assert.equal(containsPixelClone("hsl(190 82% 31%)"), true);
  assert.equal(containsPixelClone("data:image/png;base64,iVBORw0KGgo="), true);

  const dna = makeDna();
  const hexAnchor = {
    ...dna,
    colourAnchor: { ...dna.colourAnchor, accentHue: "#0e7490" },
  };
  const findings = validateReferenceDna(hexAnchor);
  assert.ok(findings.some(({ code, gate, severity }) =>
    code === "dna-pixel-clone-refused" && gate === "hard" && severity === "critical",
  ));

  const tokenPairing = {
    ...dna,
    typePairing: { ...dna.typePairing, displayVoice: "oklch(0.20 0.012 255) grotesque" },
  };
  assert.ok(validateReferenceDna(tokenPairing).some(({ code }) => code === "dna-pixel-clone-refused"));
});

test("DNA artifact rejects unknown top-level fields and enforces the canonical structure", () => {
  const dna = makeDna();
  const withRuleFields = { ...dna, selectedRuleIds: ["typography.role-contrast"] };
  const findings = validateReferenceDna(withRuleFields);
  assert.ok(findings.some(({ code }) => code === "dna-structure-contract"));
  assert.equal(asReferenceDnaArtifact(withRuleFields), undefined);

  const missingBoundary = { ...dna } as Record<string, unknown>;
  delete missingBoundary.boundary;
  assert.ok(validateReferenceDna(missingBoundary).some(({ code }) => code === "dna-boundary-contract"));
});

test("reference-dna schema is published in the domain manifest", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("domains/frontend/domain.manifest.json"), "utf8"));
  assert.ok(manifest.artifacts.schemas.includes("schemas/reference-dna.schema.json"));
});
