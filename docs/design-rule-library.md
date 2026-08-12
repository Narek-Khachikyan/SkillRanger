# Frontend Design Rule Library

The frontend knowledge library separates product selection, reusable design rules, and explanatory worked examples:

- recipes identify a product grammar from evidence;
- rules encode versioned decisions that can be verified;
- example packs show good and bad outcomes for desktop, mobile, loading, empty, error, and success states.

## Six Rule Families

Every material direction selects exactly one compatible rule from each family, in this order: `typography`, `layout`, `responsive`, `color`, `state`, and `signature-move`. The canonical index is `domains/frontend/rules/index.json`.

Each rule declares:

- `id`, `version`, and `family` for stable references;
- `recipeIds` for compatibility (`*` means cross-recipe);
- `preconditions` and `intent` for when and why to apply it;
- `constraints`, `rolesConsumed`, and `responsiveBehavior` for implementation boundaries;
- `accessibility` and `antiPatterns` for required safeguards;
- `verification` for observable completion criteria;
- `provenance` for the source, page/state, review or capture date, extraction method/schema, and evidence status.

The published rule-record contract is [`domains/frontend/schemas/design-rule.schema.json`](../domains/frontend/schemas/design-rule.schema.json), version `1.1`. Version `1.1` names the stronger 0.4.0 provenance shape explicitly instead of silently redefining the earlier `1.0` record. It is a closed, normalized SkillRanger shape: raw Google `DESIGN.md`, TypeUI, Tailwind, DTCG, or token payloads are research inputs, not rule records. The loader rejects unknown fields and requires every rule to carry all of the semantic fields above.

## Corpus and Provenance Boundary

The accepted reference corpus is role-separated. It supplies observations and hypotheses; it does not supply copyable product identity or production templates.

| Source role | Accepted use | Not accepted as |
| --- | --- | --- |
| Refero semantic reference | Primary source for role vocabulary and observable relationships | A source product's canonical SkillRanger system or drop-in tokens |
| Neuform public template | Qualitative comparison of hierarchy, density, panels, and rhythm | Proof of visual superiority or a reusable template |
| DesignMD and designmd.supply | Triangulation extractors for an approved public page | Independent product evidence or unchanged `DESIGN.md` content |
| getdesign.md | Catalog and follow-up reference | Verified instant public extraction authority |
| design-md-chrome | Browser capture convenience; retain its TypeUI schema as provenance | Google-format `DESIGN.md` or SkillRanger runtime content |

Each provenance entry has this closed shape:

- `source`: a URL or stable source identifier;
- optional `page` and `state`, when the inspected route or public UI state is known;
- optional `productId`, required on at least two records with distinct values when a normative rule revision claims independent-product recurrence;
- `reviewedAt` or `capturedAt` as an ISO calendar date;
- `extractionMethod` and `extractionSchema`, preserving how the observation was obtained;
- `evidenceStatus`: `observed`, `inferred`, `assumed`, or `unknown`.

Every bundled 0.4.0 rule carries at least two distinct source records. The
Refero and DesignMD records are independent extraction paths for the accepted
corpus and remain `inferred` after normalization; they are not a claim that an
extractor output is an official source design system. The normalized source
ledger is [`docs/FRONTEND_DESIGN_PATTERN_DISTILLATION_2026-08-04.md`](./FRONTEND_DESIGN_PATTERN_DISTILLATION_2026-08-04.md), whose source table
retains the accepted public URLs, inspected pages/states, and extractor roles.
Source-level recurrence is a minimum provenance gate; a new rule still needs
independent-product evidence and the visual promotion gates described below.

The bundled rules are normalized observations. Exact source tokens, typefaces, geometry, composition, motion, and trade dress remain provenance-labelled worked-example material rather than universal rules.

## Semantic Version Policy

The current 18 rule identifiers are the compatibility boundary. A normative edit to `recipeIds`, `preconditions`, `intent`, `constraints`, `rolesConsumed`, `responsiveBehavior`, `accessibility`, `antiPatterns`, or `verification` requires a new semantic `version` (for example, `1.1.0`) and provenance identifying at least two independent products. A name, wording, or provenance correction may keep the existing version when the normative digest is unchanged. The loader checks this distinction against the bundled corpus baseline and rejects a same-version normative edit. When a normative revision is released, its new semantic version and digest must be recorded in that baseline in the same change; the baseline is frozen at runtime so callers cannot rewrite the compatibility anchor.

Adding a rule family or silently replacing a stable identifier is a contract change. It requires an explicit corpus/version decision and matching contract and compatibility tests.

## Selection Contract

1. Load the eight recipes and rank them from product evidence.
2. Select the policy-permitted recipe.
3. Load `domains/frontend/rules/index.json` and select exactly one compatible rule per family.
4. Record the six selected rule ids in the structured direction metadata before implementation.
5. New directions use direction schemaVersion `1.1` and also record the identity fields: a named `macrostructure` and the three `themeAxes` (`paperBand`, `displayStyle`, `accentHue`). Legacy `1.0` directions remain loadable: the validator accepts both versions, so persisted runs recorded against `1.0` keep working.
6. Open `domains/frontend/examples/<recipe-id>/example.json` and compare the direction with its good and bad scenes.

The constrained profile always uses this six-rule selection. The standard profile compares alternatives using rule ids, so differences are explicit rather than described as taste. The advanced profile may deviate only after destructive critique names the violated rule, product benefit, accessibility effect, and verification replacement.

## Worked Examples

Each recipe pack contains ten scenes: good and bad desktop success, good and bad mobile success, plus good and bad mobile loading, empty, and error states. Generate their deterministic assets with:

```bash
node src/domains/frontend/design/generate-example-assets.ts
```

The generated SVG plates are explanatory evidence. They make hierarchy, state treatment, responsive transformation, applied rules, and violated rules inspectable. They are not production UI templates and must not be copied as JSX, CSS, component structure, or visual trade dress.

After changing a pack or renderer, run the generator twice and require a zero diff on the second run.
