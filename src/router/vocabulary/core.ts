import type { RoutingVocabularyFile } from "./types.ts";

export const coreRoutingVocabulary = {
  schemaVersion: "routing-vocabulary/1.0",
  owner: { kind: "core", id: "core" },
  creatableArtifactIds: ["application", "component", "form", "page", "service"],
  entries: [
    {
      kind: "action",
      id: "create",
      locale: "mixed",
      phrases: ["create"],
      negativePhrases: ["не создавай", "не делай", "do not create", "don't create", "do not build", "don't build"],
    },
  ],
} satisfies RoutingVocabularyFile;

