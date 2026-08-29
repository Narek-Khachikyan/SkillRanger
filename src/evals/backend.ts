import { readFile } from "node:fs/promises";
import { loadLocalRegistry } from "../registry/index.ts";
import { recommendSkills } from "../recommender/index.ts";
import { scanProject } from "../scanner/index.ts";
import { defaultRegistryRoot } from "../paths.ts";
import type { Recommendation } from "../types.ts";

export type BackendEvalLocale = "en" | "ru" | "all";

export type BackendTriggerPrompt = {
  id: string;
  kind: "should-trigger" | "should-not-trigger" | "ambiguous";
  expectedSkill?: string;
  routingExpected?: {
    expectedSkill?: string;
    acceptableAlternates?: string[];
    shouldNotTrigger?: boolean;
  };
  text: string;
};

export type BackendEvalSuite = {
  schemaVersion: "1.0";
  name: string;
  targetCounts: {
    triggerPrompts: number;
    taskEvals: number;
  };
  triggerPrompts: BackendTriggerPrompt[];
  taskEvals?: Array<{
    id: string;
    kind: string;
    expectedSkill: string;
    text: string;
  }>;
  taskBands?: Array<unknown>;
  scoring?: unknown;
  skillSlices?: Array<{
    id: string;
    skillId: string;
    taskIds: string[];
    triggerPromptIds?: string[];
  }>;
};

const backendRecommendations = (recommendations: Recommendation[]) =>
  recommendations.filter((r) => r.skillId.startsWith("backend."));

const topSkillId = (recommendations: Recommendation[]) => recommendations[0]?.skillId ?? null;

export const loadBackendEvalSuite = async (suitePath = "evals/backend/suite.json"): Promise<BackendEvalSuite> =>
  JSON.parse(await readFile(suitePath, "utf8")) as BackendEvalSuite;

export const runBackendRoutingEval = async (options: {
  projectRoot: string;
  targetAgent?: string;
  registryRoot?: string;
  locale?: BackendEvalLocale;
}) => {
  const targetAgent = options.targetAgent ?? "codex";
  const locale = options.locale ?? "all";
  const suite = await loadBackendEvalSuite();
  const fingerprint = await scanProject(options.projectRoot);
  const skills = await loadLocalRegistry(options.registryRoot ?? defaultRegistryRoot);
  let passed = 0;
  let failed = 0;
  const failures: Array<{ id: string; expected: string; actual: string | null }> = [];
  const cyrillicPattern = /\p{Script=Cyrillic}/u;
  const latinPattern = /\p{Script=Latin}/u;
  const selectPrompts = suite.triggerPrompts.filter((p) => {
    if (locale === "all") return true;
    if (locale === "ru") return cyrillicPattern.test(p.text);
    return latinPattern.test(p.text) && !cyrillicPattern.test(p.text);
  });
  for (const prompt of selectPrompts) {
    const isShouldNotTrigger = prompt.routingExpected?.shouldNotTrigger === true || prompt.kind === "should-not-trigger";
    if (isShouldNotTrigger) {
      const recs = backendRecommendations(recommendSkills(fingerprint, skills, { targetAgent, userIntent: prompt.text }));
      if (recs.length === 0) passed += 1;
      else {
        failed += 1;
        failures.push({ id: prompt.id, expected: "no backend", actual: topSkillId(recs) });
      }
      continue;
    }
    const expectedSkill = prompt.routingExpected?.expectedSkill ?? prompt.expectedSkill;
    if (!expectedSkill) continue;
    const recs = backendRecommendations(recommendSkills(fingerprint, skills, { targetAgent, userIntent: prompt.text }));
    const actual = topSkillId(recs);
    const allowed = prompt.routingExpected?.acceptableAlternates ?? [expectedSkill];
    if (actual && allowed.includes(actual)) passed += 1;
    else {
      failed += 1;
      failures.push({ id: prompt.id, expected: expectedSkill, actual });
    }
  }
  return {
    suiteName: suite.name,
    locale,
    total: selectPrompts.length,
    passed,
    failed,
    failures,
    suiteTarget: suite.targetCounts.triggerPrompts,
  };
};

import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const localeArg = args.find((arg) => arg === "--locale" || arg.startsWith("--locale="));
  let locale: BackendEvalLocale = "all";
  if (localeArg) {
    const value = localeArg.includes("=") ? localeArg.split("=")[1] : args[args.indexOf(localeArg) + 1];
    if (value === "en" || value === "ru" || value === "all") locale = value;
  }
  const projectRoot = (() => {
    const idx = args.indexOf("--project");
    if (idx !== -1 && args[idx + 1]) return path.resolve(args[idx + 1]);
    return path.resolve("fixtures/next-react-ts");
  })();
  const result = await runBackendRoutingEval({ projectRoot, locale });
  const json = args.includes("--json");
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Backend eval (${locale}): ${result.passed}/${result.total} passed`);
    for (const f of result.failures) console.log(`- ${f.id}: expected ${f.expected}, actual ${f.actual}`);
  }
  if (result.failed > 0) process.exitCode = 1;
}
