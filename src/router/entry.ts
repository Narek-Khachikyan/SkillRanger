import type { ProjectFingerprint } from "../types.ts";
import type { SkillCatalogSnapshot } from "./catalog.ts";
import { defaultRouterLimits, type RouterLimits } from "./composer.ts";
import type { ContinuationAnswer } from "./continuation.ts";
import { RouterPrepareError } from "./errors.ts";
import {
  runRoutingPipeline,
  type RoutingPipelineDecision,
} from "./pipeline.ts";
import type { RoutingProposalInput } from "./routing-proposal.ts";
import type { SemanticHintsInput, TriggerParseResult } from "./types.ts";
import type { RoutingWorld } from "./world.ts";

// The Routing entry: the one deep, in-memory entry every adapter calls with a
// preloaded Routing world and adapter-owned handles. It assembles the Routing
// pipeline input in exactly one place and owns the decision-shaping rules
// shared by all adapters (capability normalization; the fallback warning lives
// inside the pipeline decision itself). Task preparation and both router
// evaluation suites route through it, so a valid capability list and a
// fallback decision can never mean different things per adapter. The pipeline
// remains the exported pure core and is wrapped, not changed; trigger parsing,
// router config, fingerprints, routing dates, and limits stay with the
// adapters, per the Routing world boundary.

const canonical = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const targetPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

// The single definition of a valid capability list: canonical form, deduplicated
// against the always-present filesystem capability, and sorted. Every adapter
// (task preparation and both evaluation suites) normalizes through this
// function, so the evaluations can never silently disagree with production
// about what a valid capability list is.
export const normalizeCapabilities = (capabilities: string[] = []): string[] => {
  const values = [
    canonical("filesystem"),
    ...capabilities.map((id) => canonical(id)).filter((id) => id !== "filesystem"),
  ];
  if (values.some((value) => !targetPattern.test(value)) || new Set(values).size !== values.length) {
    throw new RouterPrepareError("capability-invalid", "Capabilities must be unique canonical IDs.");
  }
  return values.sort();
};

export type RoutingEntryInput = {
  // The preloaded Routing world: router skill metadata, domain metadata, and
  // the routing context. It reaches the entry as one object so the face stays
  // small as the world grows.
  world: RoutingWorld;
  // Adapter-owned: the project fingerprint (scanned in task preparation,
  // empty or synthetic in the evaluations).
  fingerprint: ProjectFingerprint;
  // Trigger info: the adapter parses the trigger (it owns the raw prompt and
  // the config intent budget) and rejects unactivated triggers before the call.
  trigger: Extract<TriggerParseResult, { activated: true }>;
  activation: { mode: "explicit" | "direct" };
  targetAgent: string;
  strict: boolean;
  capabilities: string[];
  routingDate: string;
  // Adapter-owned limits (task preparation merges router config into the
  // defaults); the default limits apply when omitted.
  limits?: RouterLimits;
  // Preloaded catalog snapshot, required exactly when a routing proposal is
  // submitted (asserted by the pipeline as an input invariant).
  catalog?: SkillCatalogSnapshot;
  // A routing proposal or semantic hints — mutually exclusive, asserted by the
  // pipeline on its input.
  routingProposal?: RoutingProposalInput;
  semanticHints?: SemanticHintsInput;
  // Validated clarification answers, supplied only on the continuation pass of
  // a previously returned clarification decision.
  answers?: ContinuationAnswer[];
};

export const runRoutingEntry = (input: RoutingEntryInput): RoutingPipelineDecision => {
  const capabilities = normalizeCapabilities(input.capabilities);
  return runRoutingPipeline({
    trigger: input.trigger,
    activation: input.activation,
    skills: input.world.skills,
    domains: input.world.domains,
    fingerprint: input.fingerprint,
    routingContext: input.world.routingContext,
    targetAgent: input.targetAgent,
    strict: input.strict,
    capabilities,
    routingDate: input.routingDate,
    limits: input.limits ?? defaultRouterLimits,
    ...(input.catalog !== undefined ? { catalog: input.catalog } : {}),
    ...(input.routingProposal !== undefined ? { routingProposal: input.routingProposal } : {}),
    ...(input.semanticHints !== undefined ? { semanticHints: input.semanticHints } : {}),
    ...(input.answers !== undefined ? { answers: input.answers } : {}),
  });
};
