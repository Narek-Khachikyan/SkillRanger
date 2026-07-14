import type { VerificationReport } from "../types.ts";

export type SkillRunState = "created" | "skills-selected" | "skills-read" | "clarified" | "running" | "implemented" | "verified" | "implemented-unverified" | "failed" | "blocked";
export type SkillRunLocale = "en" | "ru" | "mixed" | "unknown";
export type SkillRunErrorCode = "run-not-found" | "invalid-transition" | "mandatory-skill-unread" | "stale-skill-checksum" | "clarification-required" | "verification-blocked" | "run-integrity";

export type SkillRunArtifact = { kind: string; path?: string; description: string };

export type SkillRunPolicyDecision = {
  lifecycleRequired: boolean;
  mandatorySkillIds: string[];
  clarification: { required: boolean; questions: Array<{ id: string; fields: string[]; text: string; allowDecline: boolean }> };
  verificationRequired: boolean;
  artifacts?: Record<string, unknown>;
};

export type SkillRunSkill = { skillId: string; role: "primary" | "companion"; version: string; checksum: string; mandatory: boolean };

export type CreateSkillRunInput = {
  runId: string;
  domain: string;
  targetAgent: string;
  locale: SkillRunLocale;
  intent: SkillRun["intent"];
  policy: SkillRunPolicyDecision;
  now?: string;
};

export type SkillRunEvent =
  | { type: "select-skills"; skills: SkillRunSkill[] }
  | { type: "record-skill-read"; skillId: string; checksum: string }
  | { type: "resolve-clarification"; answers: Array<{ questionId: string; answer: string }>; declinedFields: string[]; assumptions: string[] }
  | { type: "start-execution" }
  | { type: "complete-execution"; status: "implemented" | "failed" | "blocked"; artifacts: SkillRunArtifact[] }
  | { type: "record-verification"; reportPath: string; reportSha256: string; report: VerificationReport };

export type SkillRun = {
  schemaVersion: "1.0";
  runId: string;
  domain: string;
  targetAgent: string;
  locale: SkillRunLocale;
  state: SkillRunState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  intent: { sha256: string; normalizedGoal: string; raw?: string };
  policy: SkillRunPolicyDecision;
  recommendations: SkillRunSkill[];
  selectedSkills: SkillRunSkill[];
  skillReads: Array<{ skillId: string; version: string; checksum: string; recordedAt: string }>;
  clarification: { status: "not-required" | "pending" | "resolved" | "declined"; questions: SkillRunPolicyDecision["clarification"]["questions"]; answers: Array<{ questionId: string; answer: string }>; declinedFields: string[]; assumptions: string[] };
  artifacts: SkillRunArtifact[];
  verification?: { reportPath: string; reportSha256: string; report: VerificationReport };
};

export class SkillRunError extends Error {
  readonly code: SkillRunErrorCode;

  constructor(code: SkillRunErrorCode, message: string) {
    super(message);
    this.name = "SkillRunError";
    this.code = code;
  }
}
