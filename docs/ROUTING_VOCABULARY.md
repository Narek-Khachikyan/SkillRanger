# Routing Vocabulary

Natural-language routing is data-driven. Core owns universal actions, common
artifacts, qualities, constraints, and acceptance criteria. Each Domain Pack may
own translated or colloquial phrases for IDs already declared by that domain or
its skills.

## Domain Pack authoring

Add a `routingVocabulary` path to `domain.manifest.json` and place a
`routing-vocabulary/1.0` JSON file inside the same Domain Pack:

```json
{
  "schemaVersion": "routing-vocabulary/1.0",
  "owner": { "kind": "domain", "id": "example" },
  "intentMappings": [
    { "signalId": "friendly-output", "skillIntentIds": ["friendly-output"] }
  ],
  "creatableArtifactIds": ["example-page"],
  "entries": [
    {
      "kind": "artifact",
      "id": "example-page",
      "locale": "mixed",
      "phrases": ["example page", "пример страницы"]
    }
  ]
}
```

Keep claims finite and exact. Add only phrases supported by a routing case; the
matcher does not stem words, generate plurals, or expand synonyms. The owner
must declare every claimed artifact, intent, technology, or quality ID through
its domain/skill metadata. `intentMappings` translates a vocabulary signal into
the intent IDs used by that domain's skills. `creatableArtifactIds` controls
which matched artifact nouns can participate in guarded request-frame create
inference.

Use `negativePhrases` when a positive phrase can be explicitly negated. Required
evidence must remain typed in the Domain Pack ownership rule and restricted to
approved direct-prompt sources; baseline aliases, fingerprints, and host hints
cannot satisfy it.

Vocabulary loading validates the schema, contained real path, byte and entry
limits, owner allowlists, duplicates, and phrase collisions. A Domain Pack must
not claim another owner's IDs or phrases. Shared phrases are accepted only by
the validator's explicit same-owner/multi-kind rules.

After adding vocabulary, add the smallest focused vocabulary/extensibility test
and a routed golden case, then run:

```bash
pnpm check
pnpm test
pnpm eval:router
```

No Analyzer, Resolver, or Composer branch should be needed for a new Domain
Pack vocabulary entry.

## Nomination evidence contract (ADR 0003)

Exact prompt evidence grounds each nomination: each nomination's `evidenceText` must
be a verbatim quote from the user's prompt. The host's evidence and the prompt are
compared after routing normalization — NFKC case folding (including `ё` → `е`),
every punctuation and symbol that is not a word character is mapped to a space
(with `+`, `#`, `.` and `/` preserved only inside technology tokens), whitespace
collapsed to single spaces and trimmed — summarized as case folding,
punctuation-to-space, whitespace collapse. If the normalized `evidenceText` is not a
substring of the normalized prompt (or is empty after normalization), the nomination
is rejected with `evidence-not-in-normalized-prompt`; paraphrases are therefore
rejected. The rule is enforced per nomination; valid nominations still compose while
rejected ones surface as `routing-proposal-rejected:*` warnings or, when no valid
nomination remains, as a `routing-proposal-invalid` error whose details list every
rejection. This contract is visible to the host before its first proposal through the
`evidenceText` input-schema description and the managed role-aware nomination guidance
(which propagates to the `prepare_task` and `inspect_skill_catalog` tool descriptions,
the MCP protocol instructions, and the managed AGENTS.md block).
