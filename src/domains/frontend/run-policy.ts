import type { SkillRunPolicyDecision } from "../../runtime/skill-run/types.ts";
import type { DomainRunPolicyInput } from "../types.ts";
import { asDesignBrief } from "./design/index.ts";
import { analyzeFrontendIntent } from "./intents/index.ts";
import { planFrontendPhases } from "./phases.ts";

const materialSkillIds = new Set([
  "frontend.visual-design-polish",
  "frontend.design-to-code",
  "frontend.motion-design",
]);

const verificationSkillIds = new Set([
  "frontend.accessibility-review",
  "frontend.audit",
  "frontend.design-system",
  "frontend.design-to-code",
  "frontend.interaction-polish",
  "frontend.motion-audit",
  "frontend.motion-design",
  "frontend.performance-review",
  "frontend.tailwind-ui-polish",
  "frontend.ux-critique",
  "frontend.visual-design-polish",
]);

const newBuildPattern = /\b(new (?:frontend|landing|page|site|app|ui)|build (?:a )?new|from scratch)\b|(?:с нуля|нов(?:ый|ую|ое) (?:фронтенд|лендинг|страниц|сайт|приложен|интерфейс))/u;
const redesignPattern = /\b(?:redesign|rebrand|refresh|revamp|modernize)\b|(?:редизайн|ребрендинг|освежить дизайн)/u;
const provenancePattern = /\b(?:metrics?|benchmarks?|testimonials?|quotes?|brands?)\b|(?:метрик\p{L}*|бенчмарк\p{L}*|отзыв\p{L}*|цитат\p{L}*|бренд\p{L}*|показател\p{L}*)/u;

const unknown = (value: unknown) =>
  typeof value !== "string" || value.trim() === "" || value.trim().toLowerCase() === "unknown";

const hasSourcedObservation = (value: unknown) => {
  const brief = asDesignBrief(value);
  const observed = brief?.evidence?.observed;
  if (!Array.isArray(observed)) return false;
  return observed.some((entry) =>
    typeof entry === "object"
    && entry !== null
    && !Array.isArray(entry)
    && typeof entry.source === "string"
    && entry.source.trim() !== ""
  );
};

export const evaluateFrontendRunPolicy = (
  input: DomainRunPolicyInput,
): SkillRunPolicyDecision => {
  const analysis = analyzeFrontendIntent(input.intent);
  const brief = asDesignBrief(input.artifacts?.designBrief);
  const material = input.recommendations.some(({ skillId }) => materialSkillIds.has(skillId))
    || (analysis.intents.has("visual-design-polish") && redesignPattern.test(analysis.normalized))
    || newBuildPattern.test(analysis.normalized);
  const questions: SkillRunPolicyDecision["clarification"]["questions"] = [];

  if (material && unknown(brief?.product.primaryUserOrActor)) {
    questions.push({
      id: "primary-user-or-actor",
      fields: ["primaryUserOrActor"],
      text: "Who is the primary user or actor for this frontend?",
      allowDecline: true,
    });
  }

  if (material) {
    const fields = [
      ...(unknown(brief?.product.primaryTask) ? ["primaryTask"] : []),
      ...(unknown(brief?.surface.primaryAction) ? ["primaryAction"] : []),
    ];
    if (fields.length > 0) {
      questions.push({
        id: "primary-task-and-action",
        fields,
        text: "What primary task should the frontend support, and what action completes it?",
        allowDecline: true,
      });
    }
  }

  if (
    provenancePattern.test(analysis.normalized)
    && !hasSourcedObservation(input.artifacts?.designBrief)
  ) {
    questions.push({
      id: "content-provenance",
      fields: ["contentProvenance"],
      text: "What observed source supports the requested claims or branded content?",
      allowDecline: false,
    });
  }

  const prioritizedQuestions = questions.slice(0, 3);
  return {
    lifecycleRequired: material || analysis.controlIntents.has("require-skill-lifecycle"),
    mandatorySkillIds: input.recommendations.map(({ skillId }) => skillId),
    clarification: {
      required: prioritizedQuestions.length > 0,
      questions: prioritizedQuestions,
    },
    verificationRequired: material
      || input.recommendations.some(({ skillId }) => verificationSkillIds.has(skillId)),
    artifacts: {
      phasePlan: planFrontendPhases({
        intent: input.intent,
        recommendedSkillIds: input.recommendations.map(({ skillId }) => skillId),
        primarySkillId: input.recommendations[0]?.skillId,
        repairFindingCodes: Array.isArray(input.artifacts?.repairFindingCodes)
          ? input.artifacts.repairFindingCodes.filter((code): code is string => typeof code === "string")
          : undefined,
        material,
      }),
    },
  };
};
