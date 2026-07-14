import phaseConfig from "../../../domains/frontend/intents/phases.json" with { type: "json" };

export type FrontendExecutionPhase =
  | "visual-direction"
  | "ux"
  | "design-system"
  | "implementation"
  | "motion"
  | "accessibility"
  | "final-audit";

export type FrontendPhasePlanEntry = {
  phase: FrontendExecutionPhase;
  ownerSkillId: string;
  status: "required" | "skipped";
  reason: string;
  skipReason?: string;
};

export type FrontendPhasePlan = {
  schemaVersion: "1.0";
  entries: FrontendPhasePlanEntry[];
  repairEntryPhase?: FrontendExecutionPhase;
  rejoinsAt: "evidence-capture";
};

const order = phaseConfig.order as FrontendExecutionPhase[];
const owners = phaseConfig.owners as Record<FrontendExecutionPhase, string>;

const findingPhaseRules: Array<[RegExp, FrontendExecutionPhase]> = [
  [/^(flow|navigation|recovery)/, "ux"],
  [/^(token|theme|primitive)/, "design-system"],
  [/^(motion|reduced-motion)/, "motion"],
  [/^(aria|keyboard|focus|invisible-focus|contrast|target)/, "accessibility"],
  [/^(spacing|color|radii|radius|shadow|card|typography|measure|touch|layout)/, "implementation"],
];

export const phaseForFinding = (code: string): FrontendExecutionPhase =>
  findingPhaseRules.find(([pattern]) => pattern.test(code.toLowerCase()))?.[1] ?? "final-audit";

const implementationOwner = (intent: string, recommended: Set<string>) => {
  const normalized = intent.toLowerCase();
  if (recommended.has("frontend.design-to-code") || /design[- ]to[- ]code|reference|figma/.test(normalized)) return "frontend.design-to-code";
  if (recommended.has("frontend.tailwind-ui-polish") || /tailwind/.test(normalized)) return "frontend.tailwind-ui-polish";
  return "frontend.react-component-design";
};

export const phaseRankForSkill = (skillId: string) => {
  const aliases: Record<string, FrontendExecutionPhase> = {
    "frontend.visual-design-polish": "visual-direction",
    "frontend.ux-critique": "ux",
    "frontend.design-system": "design-system",
    "frontend.design-to-code": "implementation",
    "frontend.tailwind-ui-polish": "implementation",
    "frontend.react-component-design": "implementation",
    "frontend.motion-design": "motion",
    "frontend.interaction-polish": "motion",
    "frontend.motion-audit": "motion",
    "frontend.accessibility-review": "accessibility",
    "frontend.audit": "final-audit",
  };
  const phase = aliases[skillId];
  return phase ? order.indexOf(phase) : order.length;
};

export const planFrontendPhases = (input: {
  intent: string;
  recommendedSkillIds: string[];
  repairFindingCodes?: string[];
  motionDirection?: "none" | string;
  material?: boolean;
}): FrontendPhasePlan => {
  const recommended = new Set(input.recommendedSkillIds);
  const normalized = input.intent.toLowerCase();
  const material = input.material ?? /reimagine|redesign|build|implement|repair|polish|ui|frontend|design|accessib|tailwind|motion|визу|дизайн|интерфейс/.test(normalized);
  const expansive = /explore|reimagine|redesign|from scratch|с нуля|редизайн/.test(normalized);
  const motion = /motion|animation|transition|анимац|движен/.test(normalized) || (input.motionDirection !== undefined && input.motionDirection !== "none");
  const implementation = implementationOwner(input.intent, recommended);
  const phaseOwners: Record<FrontendExecutionPhase, string> = { ...owners, implementation };
  const required = new Set<FrontendExecutionPhase>();
  if (material) {
    required.add("visual-direction");
    required.add("implementation");
    required.add("accessibility");
    required.add("final-audit");
  }
  if (expansive) { required.add("ux"); required.add("design-system"); }
  if (motion) required.add("motion");
  for (const phase of order) if (recommended.has(phaseOwners[phase])) required.add(phase);
  const repairPhases = (input.repairFindingCodes ?? []).map(phaseForFinding);
  const repairEntryPhase = repairPhases.length > 0
    ? [...repairPhases].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]
    : undefined;
  if (repairEntryPhase) required.add(repairEntryPhase);
  return {
    schemaVersion: "1.0",
    entries: order.map((phase) => required.has(phase)
      ? { phase, ownerSkillId: phaseOwners[phase], status: "required", reason: repairEntryPhase === phase ? "Owns the repair finding." : "Applicable to the requested material frontend work." }
      : { phase, ownerSkillId: phaseOwners[phase], status: "skipped", reason: "Phase is not applicable.", skipReason: "No matching intent, direction, recommendation, or finding." }),
    ...(repairEntryPhase ? { repairEntryPhase } : {}),
    rejoinsAt: "evidence-capture",
  };
};
