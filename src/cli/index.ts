#!/usr/bin/env node
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { scanProject } from "../scanner/index.ts";
import { loadLocalRegistry, findSkill, validateLocalRegistry } from "../registry/index.ts";
import { groupRecommendationsByLane, recommendSkills } from "../recommender/index.ts";
import { auditSkill } from "../audit/index.ts";
import { detectInstalledAgents, getAdapter } from "../installers/codex.ts";
import { setupAgentTypes, type SetupAgentType } from "../installers/agents.ts";
import { planSkillRangerAgentContext, upsertSkillRangerAgentContext } from "../installers/agent-context.ts";
import { verifyInstalledSkills } from "../installers/verify.ts";
import { applyUninstall, planUninstall } from "../installers/uninstall.ts";
import { readLockfile } from "../lockfile/index.ts";
import {
  loadFrontendEvalSuite,
  loadFrontendPairwiseReview,
  loadFrontendTaskEvidence,
  runFrontendRoutingEval,
  summarizeFrontendEvalSuite,
  summarizeFrontendVariance,
  validateFrontendPairwiseReview,
  validateFrontendTaskEvidence,
  validateFrontendEvalSuite,
  type FrontendEvalLocale,
} from "../evals/frontend.ts";
import { defaultRegistryRoot, packageRoot } from "../paths.ts";
import "../domains/bundled.ts";
import { getDomainPack, inspectDomainPack, listDomainPacks } from "../domains/registry.ts";
import {
  compileDesignFile,
  createBrowserObservationPlan,
  createDesignBriefScaffold,
  executeBrowserObservationPlan,
  loadFrontendRecipes,
  readJsonArtifact,
  recommendFrontendRecipe,
  type BrowserObservation,
  type DesignBrief,
  type DesignDirection,
  validateDesignBrief,
  validateDesignDirection,
  validateDesignResult,
  validateFrontendSourceFiles,
} from "../domains/frontend/design/index.ts";
import { createRepairRequest } from "../runtime/verification.ts";
import type { VerificationReport } from "../runtime/types.ts";
import {
  BASELINE_KINDS,
  executeRunPlan,
  generateRunPlan,
  printRunPlan,
  type BaselineConfigMap,
  type BaselineKind,
} from "../evals/runner.ts";
import { skillLanes, type InstallPlan, type ProjectFingerprint, type Recommendation, type RegistrySkill, type SkillLane } from "../types.ts";
import { parseCliInvocation, renderCommandHelp, renderRootHelp } from "./commands.ts";
import { handleRunCliCommand } from "./runs.ts";
import { summarizeSetupRecommendations } from "./setup-recommendations.ts";
import { handleVisualEvalCommand } from "./visual-eval.ts";
import { handleTaskCliCommand } from "./task.ts";

const asString = (value: string | boolean | undefined, fallback: string) => (typeof value === "string" ? value : fallback);

const requiredFlag = (value: string | boolean | undefined, name: string) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} requires a path.`);
  return path.resolve(value);
};

const asSkillLane = (value: string | boolean | undefined): SkillLane | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string" && skillLanes.includes(value as SkillLane)) {
    return value as SkillLane;
  }
  throw new Error(`--lane must be one of ${skillLanes.join(", ")}.`);
};

const asPositiveInteger = (
  value: string | boolean | undefined,
  flagName: string,
): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  throw new Error(`${flagName} must be a positive integer.`);
};

const asCapabilities = (value: string | boolean | undefined) => {
  if (value === undefined) return [];
  if (typeof value !== "string") {
    throw new Error("--capabilities must be a comma-separated list of capability names.");
  }
  const capabilities = value
    .split(",")
    .map((capability) => capability.trim().toLowerCase())
    .filter(Boolean);
  if (capabilities.length === 0) {
    throw new Error("--capabilities must include at least one capability name.");
  }
  return capabilities;
};

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2));
};

const runMode = () => {
  const entrypoint = process.argv[1] ?? "";
  const modulePath = fileURLToPath(import.meta.url);
  const candidates = [entrypoint, modulePath];
  if (candidates.some((candidate) => candidate.includes(`${path.sep}src${path.sep}`))) return "source-run";
  if (candidates.some((candidate) => candidate.includes(`${path.sep}dist${path.sep}`))) return "compiled-binary";
  return "unknown";
};

const formatScoreBreakdown = (recommendation: { scoreBreakdown: Record<string, number> }) => {
  const breakdown = recommendation.scoreBreakdown;
  return [
    `stack ${breakdown.stackMatch.toFixed(3)}`,
    `intent ${breakdown.userIntentMatch.toFixed(3)}`,
    `quality ${breakdown.effectiveQualityScore.toFixed(3)} (editorial ${breakdown.qualityScore.toFixed(3)})`,
    `security ${breakdown.securityScore.toFixed(3)}`,
    `freshness ${breakdown.freshnessScore.toFixed(3)}`,
    `compatibility ${breakdown.compatibilityScore.toFixed(3)}`,
    `evaluation penalty ${breakdown.evaluationPenalty.toFixed(3)}`,
    `lane adj ${breakdown.laneAdjustment.toFixed(3)}`,
    `skill adj ${breakdown.skillAdjustment.toFixed(3)}`,
  ].join("; ");
};

const formatProjectPath = (projectRoot: string, filePath: string) => {
  const relativePath = path.relative(projectRoot, filePath);
  return relativePath && !relativePath.startsWith("..") ? relativePath : filePath;
};

const formatSignalNames = (items: Array<{ name: string }>) => items.map((item) => item.name).join(", ") || "none detected";

const printSetupDetectedSummary = (fingerprint: ProjectFingerprint) => {
  console.log("Detected:");
  console.log(`- Types: ${fingerprint.projectTypes.map((type) => type.type).join(", ") || "unknown"}`);
  console.log(`- Languages: ${formatSignalNames(fingerprint.languages)}`);
  console.log(`- Frameworks: ${formatSignalNames(fingerprint.frameworks)}`);
  console.log(`- Styling: ${formatSignalNames(fingerprint.styling)}`);
  console.log(`- Testing: ${formatSignalNames(fingerprint.testing)}`);
  for (const warning of fingerprint.warnings) console.log(`Warning: ${warning}`);
};

const formatRecommendationChoice = (recommendation: Recommendation) => {
  const lane = recommendation.lane ?? "implementation";
  const category = recommendation.category ?? lane;
  return `${recommendation.skillId.padEnd(36)} ${category.padEnd(18)} score ${recommendation.score.toFixed(3)}  risk ${recommendation.riskLevel}`;
};

type SetupSelectionResult = {
  cancelled: boolean;
  selectedSkillIds: string[];
};

type ToggleSelectionResult<T> = {
  cancelled: boolean;
  selected: T[];
};

const promptToggleList = async <T>(options: {
  emptyMessage?: string;
  helperText: string;
  items: T[];
  initialSelected: T[];
  label: (item: T, index: number) => string;
  title: string;
}): Promise<ToggleSelectionResult<T>> => {
  if (options.items.length === 0) {
    return {
      cancelled: false,
      selected: []
    };
  }

  const stdin = process.stdin;
  const stdout = process.stdout;
  const selectedIndexes = new Set<number>(
    options.items.flatMap((item, index) => options.initialSelected.includes(item) ? [index] : [])
  );
  let cursorIndex = 0;
  let renderedLines = 0;

  const render = () => {
    if (renderedLines > 0) {
      readline.moveCursor(stdout, 0, -renderedLines);
      readline.clearScreenDown(stdout);
    }
    const lines = [
      options.title,
      options.helperText,
      "",
      ...options.items.map((item, index) => {
        const marker = selectedIndexes.has(index) ? "x" : " ";
        const cursor = index === cursorIndex ? ">" : " ";
        return `${cursor} [${marker}] ${options.label(item, index)}`;
      }),
      "",
      options.items.length === 0
        ? options.emptyMessage ?? "No items available."
        : `Selected ${selectedIndexes.size}/${options.items.length}`,
    ];
    stdout.write(`${lines.join("\n")}\n`);
    renderedLines = lines.length;
  };

  const wasRaw = stdin.isRaw ?? false;
  const hadRawMode = typeof stdin.setRawMode === "function";
  readline.emitKeypressEvents(stdin);
  if (hadRawMode) stdin.setRawMode(true);
  stdin.resume();

  let onKeypress: (input: string, key: readline.Key) => void = () => undefined;
  try {
    return await new Promise<ToggleSelectionResult<T>>((resolve) => {
      let done = false;
      const finish = (result: ToggleSelectionResult<T>) => {
        if (done) return;
        done = true;
        stdout.write("\n");
        resolve(result);
      };

      onKeypress = (_input: string, key: readline.Key) => {
        if (key.ctrl && key.name === "c") {
          finish({ cancelled: true, selected: [] });
          return;
        }
        if (key.name === "escape" || key.name === "q") {
          finish({ cancelled: true, selected: [] });
          return;
        }
        if (key.name === "return" || key.name === "enter") {
          finish({
            cancelled: false,
            selected: options.items.filter((_item, index) => selectedIndexes.has(index))
          });
          return;
        }
        if (key.name === "up" || key.name === "k") {
          cursorIndex = Math.max(0, cursorIndex - 1);
          render();
          return;
        }
        if (key.name === "down" || key.name === "j") {
          cursorIndex = Math.min(options.items.length - 1, cursorIndex + 1);
          render();
          return;
        }
        if (key.name === "space") {
          if (selectedIndexes.has(cursorIndex)) selectedIndexes.delete(cursorIndex);
          else selectedIndexes.add(cursorIndex);
          render();
          return;
        }
        if (key.name === "a") {
          if (selectedIndexes.size === options.items.length) selectedIndexes.clear();
          else options.items.forEach((_item, index) => selectedIndexes.add(index));
          render();
        }
      };

      stdin.on("keypress", onKeypress);
      render();
    });
  } finally {
    stdin.off("keypress", onKeypress);
    if (hadRawMode) stdin.setRawMode(wasRaw);
    if (!wasRaw) stdin.pause();
  }
};

const promptCheckboxRecommendations = async (recommendations: Recommendation[]): Promise<SetupSelectionResult> => {
  const result = await promptToggleList({
    helperText: "Use Up/Down to move, Space to toggle, Enter to continue, q/Esc to cancel.",
    items: recommendations,
    initialSelected: recommendations,
    label: (recommendation) => formatRecommendationChoice(recommendation),
    title: "Recommended skills:"
  });
  return {
    cancelled: result.cancelled,
    selectedSkillIds: result.selected.map((recommendation) => recommendation.skillId)
  };
};

const promptTargetAgents = async (detectedAgents: SetupAgentType[]) => {
  const available = [...setupAgentTypes];
  const initialSelected = detectedAgents.length > 0 ? detectedAgents : ["claude-code", "codex", "opencode"].filter(
    (target): target is SetupAgentType => available.includes(target as SetupAgentType)
  );
  return promptToggleList({
    helperText: "Use Up/Down to move, Space to toggle, Enter to continue, q/Esc to cancel.",
    items: available,
    initialSelected,
    label: (target) => `${target}${detectedAgents.includes(target) ? "  detected" : ""}`,
    title: "Install for which agents?"
  });
};

const promptYesNo = async (message: string): Promise<boolean> => {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const wasRaw = stdin.isRaw ?? false;
  const hadRawMode = typeof stdin.setRawMode === "function";

  readline.emitKeypressEvents(stdin);
  if (hadRawMode) stdin.setRawMode(true);
  stdin.resume();
  stdout.write(`${message} (y/N) `);

  let onKeypress: (input: string, key: readline.Key) => void = () => undefined;
  try {
    return await new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (confirmed: boolean, output: string) => {
        if (done) return;
        done = true;
        stdout.write(`${output}\n`);
        resolve(confirmed);
      };
      onKeypress = (_input: string, key: readline.Key) => {
        if (key.ctrl && key.name === "c") {
          finish(false, "");
          return;
        }
        if (key.name === "return" || key.name === "enter" || key.name === "escape" || key.name === "n") {
          finish(false, key.name === "n" ? "n" : "");
          return;
        }
        if (key.name === "y") finish(true, "y");
      };

      stdin.on("keypress", onKeypress);
    });
  } finally {
    stdin.off("keypress", onKeypress);
    if (hadRawMode) stdin.setRawMode(wasRaw);
    if (!wasRaw) stdin.pause();
  }
};

const formatTargetAgents = (targets: string[]) => targets.join(", ");

const chooseSetupScope = async (scopeFlag: string | boolean | undefined, interactive: boolean) => {
  if (scopeFlag === "repo" || scopeFlag === "user") return scopeFlag;
  if (!interactive) return "repo";
  const globalInstall = await promptYesNo("Install globally for your user account?");
  return globalInstall ? "user" : "repo";
};

const chooseSetupInstallMode = async (copyFlag: string | boolean | undefined, interactive: boolean) => {
  if (copyFlag) return "copy" as const;
  if (!interactive) return "symlink" as const;
  const useSymlink = await promptYesNo("Use symlinks instead of copies where possible?");
  return useSymlink ? "symlink" : "copy";
};

const asSupportedSetupTarget = (value: string): SetupAgentType | undefined => {
  return setupAgentTypes.includes(value as SetupAgentType) ? value as SetupAgentType : undefined;
};

const parseSetupTargets = (targetFlag: string | boolean | undefined): SetupAgentType[] | undefined => {
  if (targetFlag === undefined) return undefined;
  if (typeof targetFlag !== "string" || targetFlag.trim() === "") {
    throw new Error(`--target must be one of ${setupAgentTypes.join(", ")}.`);
  }
  const parsedTargets = targetFlag.split(",").map((target) => target.trim()).filter(Boolean);
  const invalidTargets = parsedTargets.filter((target) => !asSupportedSetupTarget(target));
  if (invalidTargets.length > 0) {
    throw new Error(`--target must be one or more of ${setupAgentTypes.join(", ")} (invalid: ${invalidTargets.join(", ")}).`);
  }
  return [...new Set(parsedTargets)] as SetupAgentType[];
};

const printSetupPlanSummary = (plans: InstallPlan[], projectRoot: string, additionalWrites: string[] = []) => {
  console.log("\nPlanned changes:");
  console.log("Would write:");
  for (const write of plans.flatMap((plan) => plan.writes)) {
    console.log(`- ${formatProjectPath(projectRoot, write)}`);
  }
  for (const write of additionalWrites) {
    console.log(`- ${formatProjectPath(projectRoot, write)}`);
  }
  console.log("Would update:");
  for (const update of [...new Set(plans.flatMap((plan) => plan.lockfileUpdates))]) {
    console.log(`- ${formatProjectPath(projectRoot, update)}`);
  }
  for (const warning of plans.flatMap((plan) => plan.warnings)) {
    console.log(`Warning: ${warning}`);
  }
};

const printInstallSummary = (
  plan: {
    skillId: string;
    targetAgent: string;
    scope: string;
    writes: string[];
    lockfileUpdates: string[];
    warnings: string[];
  },
  projectRoot: string,
  dryRun: boolean,
) => {
  console.log(dryRun ? `Install plan for ${plan.skillId}` : `Installed ${plan.skillId}`);
  console.log(`Target: ${plan.targetAgent}, scope ${plan.scope}`);
  console.log(dryRun ? "Would write:" : "Wrote:");
  for (const write of plan.writes) {
    console.log(`- ${formatProjectPath(projectRoot, write)}`);
  }
  console.log(dryRun ? "Would update:" : "Updated:");
  for (const update of plan.lockfileUpdates) {
    console.log(`- ${formatProjectPath(projectRoot, update)}`);
  }
  for (const warning of plan.warnings) {
    console.log(`Warning: ${warning}`);
  }
  if (dryRun) {
    console.log("Next: re-run with --yes to apply.");
    return;
  }
    const skillDir = plan.writes[0]
    ? path.dirname(formatProjectPath(projectRoot, plan.writes[0]))
    : ".agents/skills";
  console.log(`Use: start or reload ${plan.targetAgent} in this repo; the skill is available at ${skillDir}.`);
};

const run = async () => {
  const invocation = parseCliInvocation(process.argv.slice(2));
  if (invocation.kind === "help") {
    console.log(invocation.command ? renderCommandHelp(invocation.command) : renderRootHelp());
    return;
  }
  if (invocation.kind === "version") {
    const packageJson = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
      throw new Error("Package version is missing from package.json.");
    }
    console.log(packageJson.version);
    return;
  }

  const args = invocation;
  const command = args.command;
  const registryRoot = defaultRegistryRoot;

  if (await handleVisualEvalCommand({ command, flags: args.flags })) return;

  if (await handleTaskCliCommand({ command, positionals: args.positionals, flags: args.flags, registryRoot })) return;

  if (await handleRunCliCommand({
    command,
    positionals: args.positionals,
    flags: args.flags,
    registryRoot,
  })) return;

  if (command === "mcp") {
    const { startMcpServer } = await import("../mcp/server.ts");
    startMcpServer();
    return;
  }

  if (command === "domain:list") {
    const domains = listDomainPacks().map(inspectDomainPack);
    if (args.flags.json) printJson({ domains });
    else for (const domain of domains) console.log(`${domain.id}@${domain.version}  ${domain.displayName}`);
    return;
  }

  if (command === "domain:inspect") {
    const domainId = args.positionals[0];
    if (!domainId) throw new Error("Missing domain id.");
    const domain = getDomainPack(domainId);
    if (!domain) throw new Error(`Domain not found: ${domainId}`);
    const report = inspectDomainPack(domain);
    if (args.flags.json) printJson(report);
    else {
      console.log(`${report.displayName} (${report.id}) @ ${report.version}`);
      console.log(`Capabilities: ${report.capabilities.join(", ")}`);
      console.log(`Skills: ${report.ownership.map((rule) => rule.primarySkill).join(", ")}`);
    }
    return;
  }

  if (command === "design:brief") {
    const projectRoot = path.resolve(args.positionals[0] ?? ".");
    const fingerprint = await scanProject(projectRoot);
    const brief = createDesignBriefScaffold(fingerprint, {
      domain: typeof args.flags.domain === "string" ? args.flags.domain : undefined,
      primaryUserOrActor: typeof args.flags.user === "string" ? args.flags.user : undefined,
      primaryTask: typeof args.flags.task === "string" ? args.flags.task : undefined,
      surfaceType: typeof args.flags.surface === "string" ? args.flags.surface : undefined,
      primaryAction: typeof args.flags.action === "string" ? args.flags.action : undefined,
    });
    const outputPath = typeof args.flags.output === "string" ? path.resolve(args.flags.output) : undefined;
    if (outputPath) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
    }
    if (args.flags.json) printJson({ brief, ...(outputPath ? { outputPath } : {}) });
    else if (outputPath) console.log(`Design brief written to ${outputPath}`);
    else printJson(brief);
    return;
  }

  if (command === "design:recommend-recipe") {
    const briefPath = requiredFlag(args.flags.brief, "--brief");
    const brief = await readJsonArtifact<DesignBrief>(briefPath);
    const findings = validateDesignBrief(brief);
    const recommendations = recommendFrontendRecipe(brief, await loadFrontendRecipes());
    const report = { ok: !findings.some((finding) => finding.gate === "hard"), findings, recommendations };
    if (args.flags.json) printJson(report);
    else {
      for (const [index, recommendation] of recommendations.entries()) {
        console.log(`${index + 1}. ${recommendation.recipe.id}  score ${recommendation.score.toFixed(3)}  ${recommendation.reasons.join("; ")}`);
      }
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "design:observe") {
    const brief = await readJsonArtifact<DesignBrief>(requiredFlag(args.flags.brief, "--brief"));
    const baseUrl = asString(args.flags["base-url"], "");
    if (!baseUrl) throw new Error("--base-url is required with design:observe.");
    const commandTemplate = asString(args.flags.command, "");
    if (!commandTemplate) throw new Error("--command is required with design:observe.");
    const outputPath = path.resolve(asString(args.flags.output, path.join(".design", "observations.json")));
    const projectRoot = path.resolve(asString(args.flags.project, "."));
    const plan = createBrowserObservationPlan({
      brief,
      baseUrl,
      route: asString(args.flags.route, "/"),
      outputDir: path.dirname(outputPath),
    });
    const observations = await executeBrowserObservationPlan({
      plan,
      commandTemplate,
      outputPath,
      projectRoot,
    });
    if (args.flags.json) printJson({ outputPath, plan, observations });
    else console.log(`Browser observations written to ${outputPath}`);
    return;
  }

  if (command === "design:validate") {
    const brief = await readJsonArtifact<DesignBrief>(requiredFlag(args.flags.brief, "--brief"));
    const direction = typeof args.flags.direction === "string"
      ? await readJsonArtifact<DesignDirection>(path.resolve(args.flags.direction))
      : undefined;
    const result = direction
      ? validateDesignResult({ workflowId: "frontend.design-generation", brief, direction, capabilities: [] })
      : { findings: validateDesignBrief(brief) };
    const report = { ok: !result.findings.some((finding) => finding.gate === "hard"), ...result };
    if (args.flags.json) printJson(report);
    else for (const finding of report.findings) console.log(`[${finding.severity}] ${finding.code}: ${finding.message}`);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "design:validate-source") {
    const projectRoot = path.resolve(args.positionals[0] ?? ".");
    const files = asString(args.flags.files, "").split(",").map((file) => file.trim()).filter(Boolean);
    if (files.length === 0) throw new Error("--files is required with design:validate-source.");
    const findings = await validateFrontendSourceFiles(files, {
      projectRoot,
      semanticTokensPresent: Boolean(args.flags["semantic-tokens"]),
    });
    const report = {
      ok: !findings.some((finding) => finding.gate === "hard"),
      findings,
    };
    if (args.flags.json) printJson(report);
    else for (const finding of findings) console.log(`[${finding.severity}] ${finding.code}: ${finding.message}`);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "design:verify") {
    const brief = await readJsonArtifact<DesignBrief>(requiredFlag(args.flags.brief, "--brief"));
    const direction = await readJsonArtifact<DesignDirection>(requiredFlag(args.flags.direction, "--direction"));
    const observations = typeof args.flags.observations === "string"
      ? await readJsonArtifact<BrowserObservation[]>(path.resolve(args.flags.observations))
      : [];
    const capabilities = asCapabilities(args.flags.capabilities);
    const iteration = asPositiveInteger(args.flags.iteration, "--iteration") ?? 0;
    const result = validateDesignResult({
      workflowId: "frontend.design-generation",
      brief,
      direction,
      observations,
      capabilities,
      iteration,
    });
    if (args.flags.json) printJson(result.report);
    else {
      console.log(`Outcome: ${result.report.outcome}`);
      for (const finding of result.findings) console.log(`[${finding.severity}] ${finding.code}: ${finding.message}`);
    }
    if (["failed", "blocked"].includes(result.report.outcome)) process.exitCode = 1;
    return;
  }

  if (command === "design:repair") {
    const report = await readJsonArtifact<VerificationReport>(requiredFlag(args.flags.report, "--report"));
    const maxIterations = asPositiveInteger(args.flags["max-iterations"], "--max-iterations") ?? 3;
    const request = createRepairRequest(report, maxIterations);
    if (args.flags.json) printJson(request);
    else if (request.stopReason) console.log(`Repair stopped: ${request.stopReason}`);
    else for (const instruction of request.instructions) console.log(`- ${instruction}`);
    return;
  }

  if (command === "design:compile") {
    const brief = await readJsonArtifact<DesignBrief>(requiredFlag(args.flags.brief, "--brief"));
    const direction = await readJsonArtifact<DesignDirection>(requiredFlag(args.flags.direction, "--direction"));
    const report = typeof args.flags.report === "string"
      ? await readJsonArtifact<VerificationReport>(path.resolve(args.flags.report))
      : undefined;
    const findings = [
      ...validateDesignBrief(brief),
      ...validateDesignDirection(brief, direction),
    ];
    if (findings.some((finding) => finding.gate === "hard")) {
      if (args.flags.json) printJson({ ok: false, findings });
      else for (const finding of findings) console.log(`[${finding.severity}] ${finding.code}: ${finding.message}`);
      process.exitCode = 1;
      return;
    }
    const outputPath = path.resolve(asString(args.flags.output, path.join(".design", "DESIGN.md")));
    const result = await compileDesignFile({ brief, direction, report, outputPath });
    if (args.flags.json) printJson({ outputPath: result.outputPath, bytes: result.bytes });
    else console.log(`Design contract written to ${result.outputPath}`);
    return;
  }

  if (command === "scan") {
    const projectRoot = path.resolve(args.positionals[0] ?? ".");
    const fingerprint = await scanProject(projectRoot);
    if (args.flags.json) {
      printJson(fingerprint);
      return;
    }

    console.log(`Project: ${fingerprint.root}`);
    if (fingerprint.packageManager) {
      console.log(`Package manager: ${fingerprint.packageManager.name} (${fingerprint.packageManager.evidence.join(", ")})`);
    }
    console.log(`Types: ${fingerprint.projectTypes.map((type) => type.type).join(", ") || "unknown"}`);
    console.log(`Languages: ${fingerprint.languages.map((item) => item.name).join(", ") || "unknown"}`);
    console.log(`Frameworks: ${fingerprint.frameworks.map((item) => item.name).join(", ") || "none detected"}`);
    console.log(`Styling: ${fingerprint.styling.map((item) => item.name).join(", ") || "none detected"}`);
    console.log(`Testing: ${fingerprint.testing.map((item) => item.name).join(", ") || "none detected"}`);
    for (const warning of fingerprint.warnings) console.log(`Warning: ${warning}`);
    return;
  }

  if (command === "recommend") {
    const projectRoot = path.resolve(args.positionals[0] ?? ".");
    const targetAgent = asString(args.flags.target, "codex");
    const userIntent = typeof args.flags.intent === "string" ? args.flags.intent : undefined;
    const hostCapabilities = asCapabilities(args.flags.capabilities);
    const lane = asSkillLane(args.flags.lane);
    const limitPerLane = asPositiveInteger(args.flags["limit-per-lane"], "--limit-per-lane");
    const fingerprint = await scanProject(projectRoot);
    const skills = await loadLocalRegistry(registryRoot);
    const recommendations = recommendSkills(fingerprint, skills, {
      targetAgent,
      userIntent,
      lane,
      limitPerLane,
      hostCapabilities,
    });
    if (args.flags.json) {
      printJson({ recommendations, recommendationGroups: groupRecommendationsByLane(recommendations) });
      return;
    }
    if (recommendations.length === 0) {
      const langs = fingerprint.languages.map((l) => l.name).join(", ") || "unknown";
      const types = fingerprint.projectTypes.map((p) => p.type).join(", ") || "unknown";
      const domains = (await listDomainPacks()).map((d) => d.manifest.id).join("\n- ") || "frontend";
      console.log(`No compatible skills found.\n\nDetected:\n- Languages: ${langs}\n- Project types: ${types}\n\nBundled domains:\n- ${domains}\n\nNext:\n- continue without SkillRanger;\n- add an audited domain pack that supports this project.`);
      return;
    }
    console.log(`Recommendations for ${targetAgent}:`);
    for (const group of groupRecommendationsByLane(recommendations)) {
      console.log(`\n${group.lane}:`);
      group.recommendations.forEach((recommendation, index) => {
        const category = recommendation.category ? `  ${recommendation.category}` : "";
        console.log(`${index + 1}. ${recommendation.skillId}${category}  score ${recommendation.score.toFixed(3)}  risk ${recommendation.riskLevel}`);
        console.log(`   ${recommendation.reasons.join("; ")}`);
        if (recommendation.verification.status !== "ready") {
          console.log(`   verification: ${recommendation.verification.status} (${recommendation.verification.missingCapabilities.join(", ")} unavailable)`);
        }
        if (args.flags.explain) {
          console.log(`   score drivers: ${formatScoreBreakdown(recommendation)}`);
        }
      });
    }
    return;
  }

  if (command === "setup") {
    const autoConfirm = Boolean(args.flags.yes);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const userIntent = typeof args.flags.intent === "string" ? args.flags.intent : undefined;
    if (!interactive && !autoConfirm) {
      console.error("skillranger setup requires an interactive terminal. Use `skillranger recommend ...` and `skillranger install ... --yes` for non-interactive usage.");
      process.exitCode = 1;
      return;
    }
    if (autoConfirm && !userIntent?.trim()) {
      throw new Error("setup --yes requires --intent so SkillRanger can install one primary skill and compatible companions.");
    }

    const projectRoot = path.resolve(args.positionals[0] ?? ".");
    const lane = asSkillLane(args.flags.lane);
    const limitPerLane = asPositiveInteger(args.flags["limit-per-lane"], "--limit-per-lane");
    const fingerprint = await scanProject(projectRoot);
    const skills = await loadLocalRegistry(registryRoot);
    const explicitTargets = parseSetupTargets(args.flags.target);
    const detectedAgents = explicitTargets
      ? explicitTargets
      : (await detectInstalledAgents()).filter(
          (target): target is SetupAgentType => setupAgentTypes.includes(target as SetupAgentType)
        );

    const targetSelection = explicitTargets
      ? { cancelled: false, selected: explicitTargets }
      : interactive
        ? await promptTargetAgents(detectedAgents)
        : { cancelled: false, selected: detectedAgents };
    if (targetSelection.cancelled) {
      console.log("Cancelled. No files were changed.");
      return;
    }
    if (targetSelection.selected.length === 0) {
      console.log("No target agents selected. No files were changed.");
      return;
    }

    const targetAgents = targetSelection.selected;
    const scope = await chooseSetupScope(args.flags.scope, interactive);
    const mode = await chooseSetupInstallMode(args.flags.copy, interactive);
    const recommendationSummary = summarizeSetupRecommendations(
      targetAgents.map((targetAgent) => ({
        targetAgent,
        recommendations: recommendSkills(fingerprint, skills, {
          targetAgent,
          userIntent,
          lane,
          limitPerLane,
        }),
      })),
    );
    const recommendations = recommendationSummary.recommendations;

    console.log("SkillRanger setup");
    console.log(`Project: ${projectRoot}`);
    console.log(`Targets: ${formatTargetAgents(targetAgents)}`);
    console.log(`Scope: ${scope}`);
    console.log(`Mode: ${mode}`);
    if (recommendationSummary.targetsWithoutRecommendations.length > 0) {
      console.log(
        `No matching compatible recommendations for: ${formatTargetAgents(recommendationSummary.targetsWithoutRecommendations)}`,
      );
    }
    console.log("");
    printSetupDetectedSummary(fingerprint);
    if (!explicitTargets) {
      console.log(`Detected agents: ${detectedAgents.length > 0 ? formatTargetAgents(detectedAgents) : "none"}`);
    }
    console.log("");

    if (recommendations.length === 0) {
      const langs = fingerprint.languages.map((l) => l.name).join(", ") || "unknown";
      const types = fingerprint.projectTypes.map((p) => p.type).join(", ") || "unknown";
      const domains = (await listDomainPacks()).map((d) => d.manifest.id).join(", ") || "frontend";
      console.log(`No recommendations found for detected languages (${langs}) and project types (${types}). Available bundled domains: ${domains}. No files were changed.`);
      return;
    }

    const selection = autoConfirm
      ? { cancelled: false, selectedSkillIds: recommendations.map((recommendation) => recommendation.skillId) }
      : await promptCheckboxRecommendations(recommendations);
    if (selection.cancelled) {
      console.log("Cancelled. No files were changed.");
      return;
    }
    if (selection.selectedSkillIds.length === 0) {
      console.log("No skills selected. No files were changed.");
      return;
    }

    console.log(`Selected ${selection.selectedSkillIds.length} skills:`);
    for (const skillId of selection.selectedSkillIds) console.log(`- ${skillId}`);

    const selectedSkills: Array<{ skill: RegistrySkill; targetAgents: SetupAgentType[] }> = [];
    const plans: InstallPlan[] = [];
    for (const skillId of selection.selectedSkillIds) {
      const skill = await findSkill(skillId, registryRoot);
      if (!skill) throw new Error(`Skill not found: ${skillId}`);
      const compatibleTargets = recommendationSummary.targetsBySkillId.get(skillId) ?? [];
      selectedSkills.push({ skill, targetAgents: compatibleTargets });
      for (const targetAgent of compatibleTargets) {
        const adapter = getAdapter(targetAgent);
        plans.push(await adapter.planInstall(skill, { projectRoot, targetAgent, scope, dryRun: true, mode }));
      }
    }
    const shouldInstallAgentContext = scope === "repo" && !args.flags["no-agent-context"];
    const agentContextPlan = shouldInstallAgentContext
      ? await planSkillRangerAgentContext(projectRoot)
      : undefined;
    printSetupPlanSummary(
      plans,
      projectRoot,
      agentContextPlan?.changed ? [agentContextPlan.path] : [],
    );

    const confirmed = autoConfirm || await promptYesNo("Install selected skills into this project?");
    if (!confirmed) {
      console.log("Cancelled. No files were changed.");
      return;
    }

    console.log(`Installing ${selectedSkills.length} skills...`);
    const appliedPlans: InstallPlan[] = [];
    for (const { skill, targetAgents: compatibleTargets } of selectedSkills) {
      for (const targetAgent of compatibleTargets) {
        const adapter = getAdapter(targetAgent);
        try {
          const result = await adapter.applyInstall(skill, { projectRoot, targetAgent, scope, dryRun: false, mode });
          appliedPlans.push(result.plan);
          console.log(`Installed ${skill.manifest.id} for ${targetAgent}`);
        } catch (error) {
          console.error(`Failed to install ${skill.manifest.id} for ${targetAgent}: ${error instanceof Error ? error.message : String(error)}`);
          if (appliedPlans.length > 0) {
            console.error(`Partial install occurred. Inspect installed skills with: skillranger installed ${projectRoot}`);
          }
          process.exitCode = 1;
          return;
        }
      }
    }

    const agentContextResult = shouldInstallAgentContext
      ? await upsertSkillRangerAgentContext(projectRoot)
      : undefined;

    console.log("");
    console.log("Wrote:");
    for (const write of appliedPlans.flatMap((plan) => plan.writes)) {
      console.log(`- ${formatProjectPath(projectRoot, write)}`);
    }
    if (agentContextResult?.changed) {
      console.log(`- ${formatProjectPath(projectRoot, agentContextResult.path)}`);
    }
    console.log("Updated:");
    for (const update of [...new Set(appliedPlans.flatMap((plan) => plan.lockfileUpdates))]) {
      console.log(`- ${formatProjectPath(projectRoot, update)}`);
    }
    console.log(`Done. Installed ${appliedPlans.length} skills.`);
    return;
  }

  if (command === "audit") {
    const skillId = args.positionals[0];
    if (!skillId) throw new Error("Missing skill id.");
    const skill = await findSkill(skillId, registryRoot);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    const report = await auditSkill(skill);
    if (args.flags.json) {
      printJson(report);
      return;
    }
    console.log(`${report.skillId}: risk ${report.riskLevel}, security ${report.securityScore}, ${report.checksum}`);
    if (report.findings.length === 0) {
      console.log("No findings.");
    } else {
      for (const finding of report.findings) {
        console.log(`- [${finding.severity}] ${finding.code}${finding.path ? ` (${finding.path})` : ""}: ${finding.message}`);
      }
    }
    return;
  }

  if (command === "validate:registry" || command === "lint:skills") {
    const report = await validateLocalRegistry(registryRoot);
    if (args.flags.json) {
      printJson(report);
      return;
    }
    console.log(`Registry valid: ${report.skills.length} skills`);
    return;
  }

  if (command === "audit:registry" || command === "publish:check") {
    const validation = await validateLocalRegistry(registryRoot);
    const skills = await loadLocalRegistry(registryRoot);
    const reports = await Promise.all(skills.map((skill) => auditSkill(skill)));
    const failedReports = reports.filter((report) => report.riskLevel !== "low" || report.findings.length > 0);
    const report = {
      ok: failedReports.length === 0,
      validatedSkills: validation.skills.length,
      audits: reports
    };
    if (args.flags.json) {
      printJson(report);
    } else {
      console.log(`Registry audit: ${reports.length} skills, ${failedReports.length} failed`);
      for (const failed of failedReports) {
        console.log(`- ${failed.skillId}: risk ${failed.riskLevel}, findings ${failed.findings.length}`);
      }
    }
    if (!report.ok) {
      throw new Error("Registry audit failed.");
    }
    return;
  }

  if (command === "eval:frontend") {
    const suitePath = typeof args.flags.suite === "string" ? path.resolve(args.flags.suite) : undefined;
    const suite = await loadFrontendEvalSuite(suitePath);
    const issues = validateFrontendEvalSuite(suite);
    const runRouting = Boolean(args.flags["run-routing"]);
    const runTasks = Boolean(args.flags["run-tasks"]);
    const projectRoot = typeof args.flags.project === "string" ? path.resolve(args.flags.project) : undefined;
    const taskEvidencePath = typeof args.flags["verify-task-evidence"] === "string"
      ? path.resolve(args.flags["verify-task-evidence"])
      : undefined;
    const pairwiseReviewPath = typeof args.flags["verify-pairwise-review"] === "string"
      ? path.resolve(args.flags["verify-pairwise-review"])
      : undefined;
    const targetAgent = asString(args.flags.target, "codex");
    const localeValue = args.flags.locale ?? "all";
    if (typeof localeValue !== "string" || !["en", "ru", "all"].includes(localeValue)) {
      throw new Error("--locale must be one of: en, ru, all.");
    }
    const locale = localeValue as FrontendEvalLocale;

    if (runTasks) {
      if (issues.length > 0) {
        throw new Error(
          `Frontend eval suite validation failed: ${issues.join("; ")}`,
        );
      }
      const baselinesRaw = asString(args.flags.baselines, "without-skill,current-skill");
      const parsedBaselines = baselinesRaw
        .split(",")
        .map((baseline) => baseline.trim())
        .filter(Boolean);
      for (const baseline of parsedBaselines) {
        if (!BASELINE_KINDS.includes(baseline as BaselineKind)) {
          throw new Error(`Invalid baseline: ${baseline}. Must be one of: ${BASELINE_KINDS.join(", ")}`);
        }
      }
      const baselines = parsedBaselines as BaselineKind[];
      const commandTemplate = typeof args.flags.command === "string" ? args.flags.command : undefined;
      if (!commandTemplate) throw new Error("--command is required with --run-tasks.");
      const outputDir = typeof args.flags.output === "string"
        ? path.resolve(args.flags.output)
        : path.resolve("evals", "frontend", "results", "run-" + Date.now());
      const dryRun = Boolean(args.flags["dry-run"]);
      const resume = Boolean(args.flags.resume);
      const filterRaw = typeof args.flags.filter === "string" ? args.flags.filter : undefined;
      const filter = filterRaw ? filterRaw.split(",").map((f) => f.trim()).filter(Boolean) : undefined;
      const repetitions = asPositiveInteger(args.flags.repetitions, "--repetitions") ?? 1;
      const skillSlice = typeof args.flags["skill-slice"] === "string" ? args.flags["skill-slice"] : undefined;
      const baselineFixtureMetadata: Record<string, { kind: string; skillId?: string; skillVersion?: string; skillChecksum?: string; model?: string; fixture?: string }> = typeof args.flags["baseline-fixture-metadata"] === "string"
        ? JSON.parse(args.flags["baseline-fixture-metadata"])
        : {};
      for (const baseline of baselines) {
        if (!baselineFixtureMetadata[baseline]) {
          baselineFixtureMetadata[baseline] = { kind: baseline };
        }
      }
      if (!projectRoot) throw new Error("--project is required with --run-tasks.");

      const plan = generateRunPlan(suite, { baselines, filter, repetitions, skillSlice });

      if (!dryRun && !resume) {
        const existingTasks = await loadFrontendTaskEvidence(
          path.join(outputDir, "task-evidence.json"),
        ).catch(() => undefined);
        if (existingTasks) {
          console.error("Output directory " + outputDir + " already contains task evidence. Use --resume to continue or remove the directory first.");
          process.exitCode = 1;
          return;
        }
      }

      if (!args.flags.json) {
        console.log("Run plan:");
        printRunPlan(plan, baselineFixtureMetadata);
        if (dryRun) {
          console.log("Dry-run mode. No commands were executed.");
          return;
        }
        if (resume) {
          console.log("Resume mode: skipping tasks with existing results.");
        }
        console.log("Executing " + plan.entries.length + " runs...");
      }

      const evidence = await executeRunPlan({
        plan,
        commandTemplate,
        outputDir,
        projectRoot,
        dryRun,
        resume,
        baselinesConfig: baselineFixtureMetadata,
        quiet: Boolean(args.flags.json),
      });

      if (args.flags.json) {
        console.log(JSON.stringify(evidence, null, 2));
        return;
      }

      if (!dryRun) {
        const evidencePath = path.join(outputDir, "task-evidence.json");
        await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
        console.log("\nDone. Evidence written to " + evidencePath);
      } else {
        console.log("\nDry-run mode. No commands were executed.");
      }
      return;
    }

    if (runRouting && !projectRoot) throw new Error("--project is required with --run-routing.");
    if (args.flags["verify-task-evidence"] === true) {
      throw new Error("--verify-task-evidence requires a JSON evidence path.");
    }
    if (args.flags["verify-pairwise-review"] === true) {
      throw new Error("--verify-pairwise-review requires a JSON review path.");
    }
    const routingEval = runRouting && projectRoot
      ? await runFrontendRoutingEval(suite, { projectRoot, targetAgent, locale })
      : undefined;
    const taskEvidence = taskEvidencePath
      ? validateFrontendTaskEvidence(suite, await loadFrontendTaskEvidence(taskEvidencePath))
      : undefined;
    const varianceSummary = taskEvidencePath && args.flags["summarize-variance"]
      ? summarizeFrontendVariance(await loadFrontendTaskEvidence(taskEvidencePath), suite)
      : undefined;
    const pairwiseReview = pairwiseReviewPath
      ? validateFrontendPairwiseReview(suite, await loadFrontendPairwiseReview(pairwiseReviewPath))
      : undefined;
    const report = {
      ok:
        issues.length === 0 &&
        (!routingEval || routingEval.failures.length === 0) &&
        (!taskEvidence || taskEvidence.metrics.promotionReady) &&
        (!varianceSummary || varianceSummary.promotionReady) &&
        (!pairwiseReview || pairwiseReview.metrics.promotionReady),
      issues,
      locale,
      summary: summarizeFrontendEvalSuite(suite, locale),
      ...(routingEval ? { routingEval } : {}),
      ...(taskEvidence ? { taskEvidence } : {}),
      ...(varianceSummary ? { varianceSummary } : {}),
      ...(pairwiseReview ? { pairwiseReview } : {}),
    };
    if (args.flags.json) {
      printJson(report);
    } else {
      console.log(`Frontend eval suite: ${report.summary.name}`);
      console.log(`Locale: ${report.locale}`);
      console.log(`Trigger prompts: ${report.summary.triggerPrompts.total}/${report.summary.triggerPrompts.target} selected; suite target: ${report.summary.triggerPrompts.suiteTarget}`);
      console.log(`Task evals: ${report.summary.taskEvals.seedTasks}/${report.summary.taskEvals.target} seeded`);
      console.log(`Task bands: ${report.summary.taskEvals.bands.join(", ")}`);
      console.log(`Promotion gates: ${report.summary.promotionGates.join(", ")}`);
      if (routingEval) {
        console.log(`Routing eval: ${routingEval.metrics.passed}/${routingEval.metrics.evaluated} passed (${routingEval.metrics.overallPassRate.toFixed(3)})`);
        console.log(`Expected skill recall: ${routingEval.metrics.expectedSkillRecall.toFixed(3)}`);
        console.log(`Should-not-trigger specificity: ${routingEval.metrics.shouldNotTriggerSpecificity.toFixed(3)}`);
        for (const failure of routingEval.failures) {
          console.log(`Failure: ${failure.id} expected ${failure.expected}, received ${failure.actual ?? "none"} (${failure.reason})`);
        }
      }
      if (taskEvidence) {
        console.log(`Task evidence: ${taskEvidence.metrics.recordedTasks}/${taskEvidence.metrics.expectedTasks} tasks; ${taskEvidence.metrics.passedAssertions} passed assertions`);
        console.log(`Task-evidence promotion gate: ${taskEvidence.metrics.promotionReady ? "ready" : "blocked"}`);
        for (const issue of taskEvidence.issues) console.log(`Task evidence issue: ${issue}`);
      }
      if (varianceSummary) {
        console.log(`Variance: ${varianceSummary.repetitions} repetitions across ${varianceSummary.groups.length} model/baseline groups`);
        for (const group of varianceSummary.groups) {
          console.log(`${group.model} ${group.baseline}: mean ${group.passRate.toFixed(3)}, worst ${group.worstRunPassRate.toFixed(3)}, stddev ${group.passRateStdDev.toFixed(3)}`);
        }
        for (const issue of varianceSummary.issues) console.log(`Variance issue: ${issue}`);
      }
      if (pairwiseReview) {
        console.log(`Pairwise review: ${pairwiseReview.metrics.reviewedTasks}/${pairwiseReview.metrics.expectedTasks} tasks; candidate preference ${pairwiseReview.metrics.candidatePreferenceShare.toFixed(3)}`);
        console.log(`Pairwise promotion gate: ${pairwiseReview.metrics.promotionReady ? "ready" : "blocked"}`);
        for (const issue of pairwiseReview.issues) console.log(`Pairwise review issue: ${issue}`);
      }
      if (issues.length > 0) {
        for (const issue of issues) console.log(`Issue: ${issue}`);
      }
    }
    if (issues.length > 0) throw new Error("Frontend eval suite validation failed.");
    if (routingEval && routingEval.failures.length > 0) {
      throw new Error("Frontend routing evaluation failed.");
    }
    if (taskEvidence && !taskEvidence.metrics.promotionReady) {
      throw new Error("Frontend task evidence promotion gate failed.");
    }
    if (varianceSummary && !varianceSummary.promotionReady) {
      throw new Error("Frontend variance promotion gate failed.");
    }
    if (pairwiseReview && !pairwiseReview.metrics.promotionReady) {
      throw new Error("Frontend pairwise review promotion gate failed.");
    }
    return;
  }

  if (command === "install") {
    const skillId = args.positionals[0];
    if (!skillId) throw new Error("Missing skill id.");
    const projectRoot = path.resolve(asString(args.flags.project, "."));
    const targetAgent = asString(args.flags.target, "codex");
    const scope = asString(args.flags.scope, "repo") as "repo" | "user";
    const dryRun = Boolean(args.flags["dry-run"]) || !args.flags.yes;
    const skill = await findSkill(skillId, registryRoot);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    const adapter = getAdapter(targetAgent);
    const mode = args.flags.copy ? "copy" : "symlink";
    const plan = dryRun
      ? await adapter.planInstall(skill, { projectRoot, targetAgent, scope, dryRun, mode })
      : (await adapter.applyInstall(skill, { projectRoot, targetAgent, scope, dryRun: false, mode })).plan;
    if (args.flags.json) {
      printJson({ plan, nextStep: dryRun ? "Re-run with --yes to apply." : "Installed and locked." });
      return;
    }
    printInstallSummary(plan, projectRoot, dryRun);
    return;
  }

  if (command === "verify") {
    const projectRoot = path.resolve(asString(args.flags.project, args.positionals[0] ?? "."));
    const skillId = typeof args.flags.skill === "string" ? args.flags.skill : undefined;
    const targetAgent = typeof args.flags.target === "string" ? args.flags.target : undefined;
    const result = await verifyInstalledSkills({ projectRoot, registryRoot, skillId, targetAgent });
    if (args.flags.json) {
      printJson(result);
      if (!result.verified) process.exitCode = 1;
      return;
    }
    if (result.entries.length === 0) {
      console.log(`No matching installed skills to verify in ${projectRoot}.`);
      return;
    }
    for (const entry of result.entries) {
      console.log(entry.skillId);
      console.log(`Target: ${entry.targetAgent}`);
      console.log(`Status: ${entry.status}`);
      if (entry.reason) {
        console.log(`Reason: ${entry.reason}`);
      }
      console.log("");
    }
    if (!result.verified) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "uninstall") {
    const skillId = args.positionals[0] ?? asString(args.flags.skill, "");
    if (!skillId) throw new Error("Missing skill id for uninstall.");
    const projectRoot = path.resolve(asString(args.flags.project, "."));
    const targetAgent = typeof args.flags.target === "string" ? args.flags.target : undefined;
    const scope = (asString(args.flags.scope, "repo") as "repo" | "user");
    const dryRun = !Boolean(args.flags.yes);
    const result = dryRun
      ? { plan: await planUninstall({ projectRoot, skillId, targetAgent, scope, dryRun: true, registryRoot }), applied: false }
      : await applyUninstall({ projectRoot, skillId, targetAgent, scope, dryRun: false, registryRoot });
    if (args.flags.json) {
      printJson({ ...result, nextStep: dryRun ? "Re-run with --yes to apply uninstall." : "Uninstalled successfully." });
      return;
    }
    if (result.plan.warnings.some((w) => w.includes("is not installed"))) {
      console.log(`Skill ${skillId} is not installed.`);
      return;
    }
    if (dryRun) {
      console.log(`Would remove:`);
      for (const item of result.plan.wouldRemove) {
        console.log(`- ${item}`);
      }
      console.log("Would update:");
      for (const item of result.plan.wouldUpdate) {
        console.log(`- ${item}`);
      }
      return;
    }
    console.log(`Uninstalled ${skillId} successfully.`);
    return;
  }

  if (command === "installed") {
    const projectRoot = path.resolve(asString(args.flags.project, args.positionals[0] ?? "."));
    const lockfile = await readLockfile(projectRoot);
    if (args.flags.verify) {
      const verification = await verifyInstalledSkills({ projectRoot, registryRoot });
      if (args.flags.json) {
        printJson({ projectRoot, installed: lockfile.installed, verification });
        return;
      }
      console.log(`Installed skills for ${projectRoot}:`);
      if (lockfile.installed.length === 0) {
        console.log("No skills installed.");
        return;
      }
      const vMap = new Map(verification.entries.map((v) => [`${v.skillId}:${v.targetAgent}:${v.scope}`, v]));
      for (const entry of lockfile.installed) {
        const v = vMap.get(`${entry.skillId}:${entry.targetAgent}:${entry.scope}`);
        const statusStr = v ? ` [${v.status}]` : "";
        console.log(`- ${entry.skillId}@${entry.version} -> ${entry.installedPath} (${entry.targetAgent}, ${entry.scope})${statusStr}`);
      }
      return;
    }
    if (args.flags.json) {
      printJson({ projectRoot, installed: lockfile.installed });
      return;
    }
    console.log(`Installed skills for ${projectRoot}:`);
    if (lockfile.installed.length === 0) {
      console.log("No skills installed.");
      return;
    }
    for (const entry of lockfile.installed) {
      console.log(`- ${entry.skillId}@${entry.version} -> ${entry.installedPath} (${entry.targetAgent}, ${entry.scope})`);
    }
    return;
  }

  if (command === "doctor") {
    const skills = await loadLocalRegistry(registryRoot);
    console.log(`Registry skills: ${skills.length}`);
    console.log(`Node: ${process.version}`);
    console.log(`Run mode: ${runMode()}`);
    console.log(`Package root: ${packageRoot}`);
    console.log(`Registry root: ${registryRoot}`);
    console.log("Adapters: codex, claude-code, opencode, cursor, gemini-cli, generic-agent-skills, universal");
    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
