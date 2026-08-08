import { getDomainPack, listDomainPacks, parseValidatorId, resolveDomainPackForSkill } from "../../domains/registry.ts";
import { coreValidatorEvaluators, coreValidatorIds, type ValidatorEvaluator } from "./core-validators.ts";
import {
  StrictSkillRunError,
  type ExecutionContractV2,
  type SkillLedger,
  type SkillRunV2,
  type StrictSkillSelection,
} from "./types.ts";

export { coreValidatorIds } from "./core-validators.ts";
export { parseValidatorId } from "../../domains/registry.ts";

const coreValidatorIdSet = new Set<string>(coreValidatorIds);

export const isCoreValidatorId = (id: string) => parseValidatorId(id)?.owner === "core";

export const assertValidatorIdSyntax: (id: unknown, label?: string) => asserts id is string = (id, label = "validatorId") => {
  if (typeof id !== "string" || parseValidatorId(id) === undefined) {
    throw new Error(`${label} must be a syntactically valid core/<name> or <domain>/<name> id.`);
  }
};

export const referencedValidatorIds = (contract: Pick<ExecutionContractV2, "gates">): string[] =>
  contract.gates
    .filter(({ evaluator }) => evaluator.type === "validator")
    .map(({ evaluator }) => (evaluator as { type: "validator"; validatorId: string }).validatorId);

export class TrustedValidatorRegistry {
  private readonly ids: ReadonlySet<string>;

  private constructor(ids: ReadonlySet<string>) {
    this.ids = ids;
  }

  static fromIds(ids: Iterable<string>): TrustedValidatorRegistry {
    const entries = new Set<string>();
    for (const id of ids) {
      if (parseValidatorId(id) === undefined) throw new Error(`Validator id ${id} is not syntactically valid.`);
      entries.add(id);
    }
    return new TrustedValidatorRegistry(entries);
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  ownerOf(id: string): string | undefined {
    return parseValidatorId(id)?.owner;
  }

  resolveValidator(id: string): ValidatorEvaluator | undefined {
    if (!this.ids.has(id)) return undefined;
    const parsed = parseValidatorId(id);
    if (parsed && parsed.owner !== "core") {
      const evaluator = getDomainPack(parsed.owner)?.validatorEvaluators?.[id];
      if (evaluator) {
        return (context) => {
          if (context.gateId === undefined) {
            return { passed: false, message: `Validator ${id} requires a gate id to evaluate.` };
          }
          return evaluator({
            gateId: context.gateId,
            validatorId: id,
            skillId: context.ledger.skillId,
            artifacts: context.artifacts,
            input: context.ledger.input,
            output: context.output,
            verificationInput: context.verificationInput,
            sourceReview: context.sourceReview,
            criticReport: context.criticReport,
          });
        };
      }
    }
    return coreValidatorEvaluators[id];
  }

  domainIds(): string[] {
    return [...new Set([...this.ids].map((id) => parseValidatorId(id)!.owner))].sort();
  }

  get size(): number {
    return this.ids.size;
  }
}

export type TrustedValidatorRegistryResolver = (run: SkillRunV2) => TrustedValidatorRegistry;

export const buildTrustedValidatorRegistry = (
  ledgers: readonly Pick<SkillLedger, "skillId">[],
): TrustedValidatorRegistry => {
  const domains = new Set<string>();
  for (const ledger of ledgers) {
    const pack = resolveDomainPackForSkill(ledger.skillId);
    if (pack) domains.add(pack.manifest.id);
  }
  const ids = new Set<string>([...coreValidatorIds]);
  for (const domain of [...domains].sort()) {
    for (const id of (getDomainPack(domain)?.validators ?? []).slice().sort()) ids.add(id);
  }
  return TrustedValidatorRegistry.fromIds(ids);
};

export const resolveTrustedValidatorRegistry: TrustedValidatorRegistryResolver = (run) =>
  assertRunTrustedValidatorOwnership(run);

const bundledValidatorCatalog = (): Set<string> => {
  const ids = new Set<string>([...coreValidatorIds]);
  for (const pack of listDomainPacks()) {
    for (const id of pack.validators ?? []) ids.add(id);
  }
  return ids;
};

export const validateValidatorOwnership = (input: {
  validatorId: string;
  registry: TrustedValidatorRegistry;
  skillId: string;
  skillDomain?: string;
}): void => {
  const parsed = parseValidatorId(input.validatorId);
  if (!parsed) {
    throw new StrictSkillRunError(
      "strict-contract-missing",
      `Validator ${input.validatorId} is not a syntactically valid core/<name> or <domain>/<name> id.`,
      { reason: "validator-ownership", skillId: input.skillId, validatorId: input.validatorId },
    );
  }
  if (parsed.owner === "core") {
    if (!coreValidatorIdSet.has(input.validatorId)) {
      throw new StrictSkillRunError(
        "strict-contract-missing",
        `Core validator ${input.validatorId} is not part of the trusted runtime catalog.`,
        { reason: "validator-ownership", skillId: input.skillId, validatorId: input.validatorId },
      );
    }
    return;
  }
  if (!input.registry.has(input.validatorId)) {
    throw new StrictSkillRunError(
      "strict-contract-missing",
      `Validator ${input.validatorId} is not owned by a selected domain pack.`,
      { reason: "validator-ownership", skillId: input.skillId, validatorId: input.validatorId },
    );
  }
  if (input.skillDomain !== undefined && parsed.owner !== input.skillDomain) {
    throw new StrictSkillRunError(
      "strict-contract-missing",
      `Validator ${input.validatorId} belongs to domain ${parsed.owner}, not ${input.skillDomain}.`,
      { reason: "validator-ownership", skillId: input.skillId, validatorId: input.validatorId },
    );
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

export const assertRunTrustedValidatorOwnership = (run: SkillRunV2): TrustedValidatorRegistry =>
  assertOwnership(run.skillLedgers);

export const assertSelectionsTrustedValidatorOwnership = (
  selections: readonly StrictSkillSelection[],
): TrustedValidatorRegistry => assertOwnership(selections);

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
