import { randomUUID } from "node:crypto";
import "../domains/bundled.ts";
import { getDomainPack } from "../domains/registry.ts";
import { loadLocalRegistry } from "../registry/index.ts";
import { recommendSkills } from "../recommender/index.ts";
import {
  SkillRunError,
  SkillRunStore,
  startSkillRun,
  type SkillRunLocale,
  type SkillRunPolicyDecision,
} from "../runtime/skill-run/index.ts";
import { scanProject } from "../scanner/index.ts";

export type StartPreparedSkillRunInput = {
  projectRoot: string;
  registryRoot: string;
  targetAgent: string;
  domain: string;
  intent: string;
  artifacts?: Record<string, unknown>;
  storeRawIntent?: boolean;
};

const defaultPolicy: SkillRunPolicyDecision = {
  lifecycleRequired: false,
  mandatorySkillIds: [],
  clarification: { required: false, questions: [] },
  verificationRequired: false,
};

const intentLocale = (intent: string): SkillRunLocale => {
  const normalized = intent.normalize("NFKC").toLowerCase();
  const hasCyrillic = /[а-яё]/u.test(normalized);
  const hasLatin = /[a-z]/u.test(normalized);
  return hasCyrillic && hasLatin ? "mixed" : hasCyrillic ? "ru" : hasLatin ? "en" : "unknown";
};

const recommendationTarget = (target: string) => (
  ["opencode", "cursor", "gemini-cli"].includes(target) ? "generic-agent-skills" : target
);

export const startPreparedSkillRun = async (input: StartPreparedSkillRunInput) => {
  const domain = getDomainPack(input.domain);
  if (!domain) throw new SkillRunError("run-integrity", `Domain not found: ${input.domain}`);
  const [fingerprint, skills] = await Promise.all([
    scanProject(input.projectRoot),
    loadLocalRegistry(input.registryRoot),
  ]);
  const recommendations = recommendSkills(fingerprint, skills, {
    targetAgent: recommendationTarget(input.targetAgent),
    userIntent: input.intent,
    domainId: input.domain,
  });
  if (recommendations.length === 0) {
    throw new SkillRunError(
      "run-integrity",
      `No compatible ${input.domain} skills were recommended for target ${input.targetAgent}.`,
    );
  }
  const policy = domain.runPolicy?.evaluate({
    intent: input.intent,
    recommendations,
    ...(input.artifacts === undefined ? {} : { artifacts: input.artifacts }),
  }) ?? defaultPolicy;
  const skillById = new Map(skills.map((skill) => [skill.manifest.id, skill]));
  const selectedSkills = recommendations.map((recommendation, index) => {
    const skill = skillById.get(recommendation.skillId);
    if (!skill) {
      throw new SkillRunError(
        "run-integrity",
        `Recommended skill is missing from the registry: ${recommendation.skillId}`,
      );
    }
    return {
      skillId: recommendation.skillId,
      role: recommendation.role ?? (index === 0 ? "primary" as const : "companion" as const),
      version: skill.manifest.version,
      checksum: skill.checksum,
      mandatory: policy.mandatorySkillIds.includes(recommendation.skillId),
    };
  });
  return startSkillRun(new SkillRunStore(input.projectRoot), {
    runId: `run_${randomUUID()}`,
    domain: input.domain,
    targetAgent: input.targetAgent,
    locale: intentLocale(input.intent),
    rawIntent: input.intent,
    normalizedGoal: `${input.domain} lifecycle using ${recommendations.map(({ skillId }) => skillId).join(", ")}`,
    storeRawIntent: input.storeRawIntent,
    policy,
    selectedSkills,
  });
};
