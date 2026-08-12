import { getDomainPack, listDomainPacks, parseValidatorId, resolveDomainPackForSkill } from "./registry.ts";
import {
  coreValidatorEvaluators,
  coreValidatorIds,
  type ValidatorEvaluator,
} from "../runtime/strict/core-validators.ts";
import {
  referencedValidatorIds,
  TrustedValidatorRegistry,
  type TrustedValidatorRegistryResolver,
} from "../runtime/strict/validator-registry.ts";
import {
  StrictSkillRunError,
  type ExecutionContractV2,
  type SkillLedger,
  type SkillRunV2,
  type StrictSkillSelection,
} from "../runtime/strict/types.ts";
import type { DomainValidatorEvaluator, DomainValidatorProjection } from "./types.ts";

const coreValidatorIdSet = new Set<string>(coreValidatorIds);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const adaptDomainEvaluator = (validatorId: string, evaluator: DomainValidatorEvaluator): ValidatorEvaluator =>
  (context) => {
    if (context.gateId === undefined) {
      return { passed: false, message: `Validator ${validatorId} requires a gate id to evaluate.` };
    }
    const projection: DomainValidatorProjection = {
      gateId: context.gateId,
      validatorId,
      skillId: context.ledger.skillId,
      artifacts: context.artifacts,
      ...(isRecord(context.ledger.input) && context.ledger.input.brief !== undefined
        ? { input: { brief: context.ledger.input.brief } }
        : {}),
      ...(context.output === undefined ? {} : { output: context.output }),
      ...(context.verificationInput === undefined ? {} : { verificationInput: context.verificationInput }),
      ...(context.sourceReview === undefined ? {} : { sourceReview: context.sourceReview }),
      ...(context.direction === undefined ? {} : { direction: context.direction }),
      ...(context.verifiedRuns === undefined ? {} : { verifiedRuns: context.verifiedRuns }),
      ...(context.ledger.verificationReports.length === 0
        ? {}
        : { verificationReports: context.ledger.verificationReports }),
    };
    return evaluator(projection);
  };

export const buildTrustedValidatorRegistry = (
  ledgers: readonly Pick<SkillLedger, "skillId">[],
): TrustedValidatorRegistry => {
  const domains = new Set<string>();
  for (const ledger of ledgers) {
    const pack = resolveDomainPackForSkill(ledger.skillId);
    if (pack) domains.add(pack.manifest.id);
  }
  const declaredIds = new Set<string>([...coreValidatorIds]);
  const evaluators: Record<string, ValidatorEvaluator> = { ...coreValidatorEvaluators };
  for (const domain of [...domains].sort()) {
    const pack = getDomainPack(domain);
    if (!pack) continue;
    for (const id of (pack.validators ?? []).slice().sort()) {
      declaredIds.add(id);
      const evaluator = pack.validatorEvaluators?.[id];
      if (evaluator) evaluators[id] = adaptDomainEvaluator(id, evaluator);
    }
  }
  return TrustedValidatorRegistry.fromSources({ declaredIds: [...declaredIds], evaluators });
};

const ownershipFailure = (input: {
  validatorId: string;
  skillId: string;
  message: string;
}): StrictSkillRunError => new StrictSkillRunError(
  "strict-contract-missing",
  input.message,
  { reason: "validator-ownership", skillId: input.skillId, validatorId: input.validatorId },
);

export const validateValidatorOwnership = (input: {
  validatorId: string;
  registry: TrustedValidatorRegistry;
  skillId: string;
  skillDomain?: string;
}): void => {
  const parsed = parseValidatorId(input.validatorId);
  if (!parsed) {
    throw ownershipFailure({
      validatorId: input.validatorId,
      skillId: input.skillId,
      message: `Validator ${input.validatorId} is not a syntactically valid core/<name> or <domain>/<name> id.`,
    });
  }
  if (parsed.owner === "core") {
    if (!coreValidatorIdSet.has(input.validatorId)) {
      throw ownershipFailure({
        validatorId: input.validatorId,
        skillId: input.skillId,
        message: `Core validator ${input.validatorId} is not part of the trusted runtime catalog.`,
      });
    }
    return;
  }
  if (!input.registry.has(input.validatorId)) {
    throw ownershipFailure({
      validatorId: input.validatorId,
      skillId: input.skillId,
      message: `Validator ${input.validatorId} is not owned by a selected domain pack.`,
    });
  }
  if (input.skillDomain === undefined) {
    throw ownershipFailure({
      validatorId: input.validatorId,
      skillId: input.skillId,
      message: `Validator ${input.validatorId} belongs to domain ${parsed.owner}, but ${input.skillId} is not owned by any domain.`,
    });
  }
  if (parsed.owner !== input.skillDomain) {
    throw ownershipFailure({
      validatorId: input.validatorId,
      skillId: input.skillId,
      message: `Validator ${input.validatorId} belongs to domain ${parsed.owner}, not ${input.skillDomain}.`,
    });
  }
  if (input.registry.resolveValidator(input.validatorId) === undefined) {
    throw ownershipFailure({
      validatorId: input.validatorId,
      skillId: input.skillId,
      message: `Trusted validator implementation ${input.validatorId} is unavailable.`,
    });
  }
};

const assertOwnership = (
  entries: readonly { skillId: string; contract: ExecutionContractV2 }[],
): TrustedValidatorRegistry => {
  const registry = buildTrustedValidatorRegistry(entries);
  for (const entry of entries) {
    const pack = resolveDomainPackForSkill(entry.skillId);
    for (const validatorId of referencedValidatorIds(entry.contract)) {
      validateValidatorOwnership({ validatorId, registry, skillId: entry.skillId, skillDomain: pack?.manifest.id });
    }
  }
  return registry;
};

export const assertSelectionsTrustedValidatorOwnership = (
  selections: readonly StrictSkillSelection[],
): TrustedValidatorRegistry => assertOwnership(selections);

export const assertRunTrustedValidatorOwnership = (run: SkillRunV2): TrustedValidatorRegistry =>
  assertOwnership(run.skillLedgers);

export const resolveRunTrustedValidatorRegistry: TrustedValidatorRegistryResolver = (run) =>
  buildTrustedValidatorRegistry(run.skillLedgers);

const bundledValidatorCatalog = (): Set<string> => {
  const ids = new Set<string>([...coreValidatorIds]);
  for (const pack of listDomainPacks()) {
    for (const id of pack.validators ?? []) ids.add(id);
  }
  return ids;
};

export const assertBundledContractValidatorOwnership = (contract: ExecutionContractV2): void => {
  const catalog = bundledValidatorCatalog();
  for (const validatorId of referencedValidatorIds(contract)) {
    const parsed = parseValidatorId(validatorId);
    if (!parsed) {
      throw new Error(`Gate validator ${validatorId} is not a syntactically valid core/<name> or <domain>/<name> id.`);
    }
    if (parsed.owner === "core" && !coreValidatorIdSet.has(validatorId)) {
      throw new Error(`Gate validator ${validatorId} is not a registered core validator.`);
    }
    if (parsed.owner !== "core" && !catalog.has(validatorId)) {
      throw new Error(`Gate validator ${validatorId} is not registered by a bundled domain pack.`);
    }
  }
};
