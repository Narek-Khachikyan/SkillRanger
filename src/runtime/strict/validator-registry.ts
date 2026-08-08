import { coreValidatorEvaluators, coreValidatorIds, type ValidatorEvaluator } from "./core-validators.ts";
import { parseValidatorId } from "./validator-id.ts";
import { StrictSkillRunError, type ExecutionContractV2, type SkillRunV2 } from "./types.ts";

export { coreValidatorIds } from "./core-validators.ts";
export { parseValidatorId } from "./validator-id.ts";

export const assertValidatorIdSyntax: (id: unknown, label?: string) => asserts id is string = (id, label = "validatorId") => {
  if (typeof id !== "string" || parseValidatorId(id) === undefined) {
    throw new Error(`${label} must be a syntactically valid core/<name> or <domain>/<name> id.`);
  }
};

export const referencedValidatorIds = (contract: Pick<ExecutionContractV2, "gates">): string[] =>
  contract.gates
    .filter(({ evaluator }) => evaluator.type === "validator")
    .map(({ evaluator }) => (evaluator as { type: "validator"; validatorId: string }).validatorId);

export type TrustedValidatorRegistrySources = {
  declaredIds: readonly string[];
  evaluators: Readonly<Record<string, ValidatorEvaluator>>;
};

export class TrustedValidatorRegistry {
  private readonly declared: ReadonlySet<string>;
  private readonly evaluators: Readonly<Record<string, ValidatorEvaluator>>;

  private constructor(declared: ReadonlySet<string>, evaluators: Readonly<Record<string, ValidatorEvaluator>>) {
    this.declared = declared;
    this.evaluators = evaluators;
  }

  static fromSources(sources: TrustedValidatorRegistrySources): TrustedValidatorRegistry {
    const declared = new Set<string>();
    for (const id of sources.declaredIds) {
      if (parseValidatorId(id) === undefined) throw new Error(`Validator id ${id} is not syntactically valid.`);
      declared.add(id);
    }
    for (const id of Object.keys(sources.evaluators)) {
      if (parseValidatorId(id) === undefined) throw new Error(`Validator id ${id} is not syntactically valid.`);
    }
    return new TrustedValidatorRegistry(declared, { ...sources.evaluators });
  }

  static fromIds(ids: Iterable<string>): TrustedValidatorRegistry {
    const declared = new Set<string>();
    const evaluators: Record<string, ValidatorEvaluator> = {};
    for (const id of ids) {
      if (parseValidatorId(id) === undefined) throw new Error(`Validator id ${id} is not syntactically valid.`);
      declared.add(id);
      const evaluator = coreValidatorEvaluators[id];
      if (evaluator) evaluators[id] = evaluator;
    }
    return new TrustedValidatorRegistry(declared, evaluators);
  }

  has(id: string): boolean {
    return this.declared.has(id);
  }

  ownerOf(id: string): string | undefined {
    return parseValidatorId(id)?.owner;
  }

  resolveValidator(id: string): ValidatorEvaluator | undefined {
    return this.declared.has(id) ? this.evaluators[id] : undefined;
  }

  domainIds(): string[] {
    return [...new Set([...this.declared].map((id) => parseValidatorId(id)!.owner))].sort();
  }

  get size(): number {
    return this.declared.size;
  }
}

export type TrustedValidatorRegistryResolver = (run: SkillRunV2) => TrustedValidatorRegistry;

let registeredResolver: TrustedValidatorRegistryResolver | undefined;

export const registerTrustedValidatorRegistryResolver = (resolver: TrustedValidatorRegistryResolver): void => {
  registeredResolver = resolver;
};

export const resolveTrustedValidatorRegistry: TrustedValidatorRegistryResolver = (run) => {
  if (!registeredResolver) {
    throw new StrictSkillRunError("run-integrity", "The trusted validator registry resolver is not registered.");
  }
  return registeredResolver(run);
};
