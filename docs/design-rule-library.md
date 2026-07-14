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
- `provenance` for source and review date.

## Selection Contract

1. Load the eight recipes and rank them from product evidence.
2. Select the policy-permitted recipe.
3. Load `domains/frontend/rules/index.json` and select exactly one compatible rule per family.
4. Record the six selected rule ids in the structured direction metadata before implementation.
5. Open `domains/frontend/examples/<recipe-id>/example.json` and compare the direction with its good and bad scenes.

The constrained profile always uses this six-rule selection. The standard profile compares alternatives using rule ids, so differences are explicit rather than described as taste. The advanced profile may deviate only after destructive critique names the violated rule, product benefit, accessibility effect, and verification replacement.

## Worked Examples

Each recipe pack contains ten scenes: good and bad desktop success, good and bad mobile success, plus good and bad mobile loading, empty, and error states. Generate their deterministic assets with:

```bash
node src/domains/frontend/design/generate-example-assets.ts
```

The generated SVG plates are explanatory evidence. They make hierarchy, state treatment, responsive transformation, applied rules, and violated rules inspectable. They are not production UI templates and must not be copied as JSX, CSS, component structure, or visual trade dress.

After changing a pack or renderer, run the generator twice and require a zero diff on the second run.
