#!/usr/bin/env node
import path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { scanProject } from "../scanner/index.ts";
import { loadLocalRegistry, findSkill, validateLocalRegistry } from "../registry/index.ts";
import { groupRecommendationsByLane, recommendSkills } from "../recommender/index.ts";
import { auditSkill } from "../audit/index.ts";
import { detectInstalledAgents, getAdapter } from "../installers/codex.ts";
import { readLockfile } from "../lockfile/index.ts";
import {
  loadFrontendEvalSuite,
  runFrontendRoutingEval,
  summarizeFrontendEvalSuite,
  validateFrontendEvalSuite,
} from "../evals/frontend.ts";
import { defaultRegistryRoot, packageRoot } from "../paths.ts";
import { skillLanes, type InstallPlan, type ProjectFingerprint, type Recommendation, type RegistrySkill, type SkillLane } from "../types.ts";

const supportedSetupTargets = ["claude-code", "codex", "opencode", "cursor", "gemini-cli"] as const;
type SupportedSetupTarget = (typeof supportedSetupTargets)[number];

type ParsedArgs = {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[index + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        index += 1;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags };
};

const asString = (value: string | boolean | undefined, fallback: string) => (typeof value === "string" ? value : fallback);

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

const printHelp = () => {
  console.log(`skillranger

	Usage:
	  skillranger scan [project] [--json]
  skillranger recommend [project] [--target codex|claude-code|opencode|cursor|gemini-cli] [--intent "..."] [--capabilities browser,screenshots] [--lane <lane>] [--limit-per-lane <n>] [--explain] [--json]
  skillranger setup [project] [--target codex[,claude-code,opencode,cursor,gemini-cli]] [--intent "..."] [--scope repo|user] [--copy] [--yes] [--lane <lane>] [--limit-per-lane <n>]
	  skillranger audit <skill-id> [--json]
	  skillranger validate:registry [--json]
	  skillranger audit:registry [--json]
  skillranger lint:skills [--json]
  skillranger publish:check [--json]
  skillranger eval:frontend [--suite <path>] [--json]
  skillranger eval:frontend --run-routing --project <path> [--target codex] [--suite <path>] [--json]
  skillranger install <skill-id> --project <path> [--target codex|claude-code|opencode|cursor|gemini-cli] [--scope repo|user] [--copy] [--dry-run] [--yes]
  skillranger installed [project] [--project <path>] [--json]
  skillranger mcp
  skillranger doctor

Source-run equivalent from a checkout:
  node src/cli/index.ts <command> [...args]
`);
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
    `quality ${breakdown.qualityScore.toFixed(3)}`,
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

const promptTargetAgents = async (detectedAgents: SupportedSetupTarget[]) => {
  const available = [...supportedSetupTargets];
  const initialSelected = detectedAgents.length > 0 ? detectedAgents : ["claude-code", "codex", "opencode"].filter(
    (target): target is SupportedSetupTarget => available.includes(target as SupportedSetupTarget)
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

const mergeRecommendationsBySkillId = (recommendationLists: Recommendation[][]): Recommendation[] => {
  const merged = new Map<string, Recommendation>();
  for (const list of recommendationLists) {
    for (const recommendation of list) {
      const existing = merged.get(recommendation.skillId);
      if (!existing || recommendation.score > existing.score) {
        merged.set(recommendation.skillId, recommendation);
      }
    }
  }
  return [...merged.values()].sort((left, right) => right.score - left.score || left.skillId.localeCompare(right.skillId));
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

const asSupportedSetupTarget = (value: string): SupportedSetupTarget | undefined => {
  return supportedSetupTargets.includes(value as SupportedSetupTarget) ? value as SupportedSetupTarget : undefined;
};

const parseSetupTargets = (targetFlag: string | boolean | undefined): SupportedSetupTarget[] | undefined => {
  if (targetFlag === undefined) return undefined;
  if (typeof targetFlag !== "string" || targetFlag.trim() === "") {
    throw new Error(`--target must be one of ${supportedSetupTargets.join(", ")}.`);
  }
  const parsedTargets = targetFlag.split(",").map((target) => target.trim()).filter(Boolean);
  const invalidTargets = parsedTargets.filter((target) => !asSupportedSetupTarget(target));
  if (invalidTargets.length > 0) {
    throw new Error(`--target must be one or more of ${supportedSetupTargets.join(", ")} (invalid: ${invalidTargets.join(", ")}).`);
  }
  return [...new Set(parsedTargets)] as SupportedSetupTarget[];
};

const printSetupPlanSummary = (plans: InstallPlan[], projectRoot: string) => {
  console.log("\nPlanned changes:");
  console.log("Would write:");
  for (const write of plans.flatMap((plan) => plan.writes)) {
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
  const args = parseArgs(process.argv.slice(2));
  const command = args.command;
  const registryRoot = defaultRegistryRoot;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "mcp") {
    const { startMcpServer } = await import("../mcp/server.ts");
    startMcpServer();
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
          (target): target is SupportedSetupTarget => supportedSetupTargets.includes(target as SupportedSetupTarget)
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
    const recommendations = mergeRecommendationsBySkillId(
      targetAgents.map((targetAgent) => recommendSkills(fingerprint, skills, {
        targetAgent,
        userIntent,
        lane,
        limitPerLane,
      }))
    );

    console.log("SkillRanger setup");
    console.log(`Project: ${projectRoot}`);
    console.log(`Targets: ${formatTargetAgents(targetAgents)}`);
    console.log(`Scope: ${scope}`);
    console.log(`Mode: ${mode}`);
    console.log("");
    printSetupDetectedSummary(fingerprint);
    if (!explicitTargets) {
      console.log(`Detected agents: ${detectedAgents.length > 0 ? formatTargetAgents(detectedAgents) : "none"}`);
    }
    console.log("");

    if (recommendations.length === 0) {
      console.log("No recommendations found. No files were changed.");
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

    const selectedSkills: RegistrySkill[] = [];
    const plans: InstallPlan[] = [];
    for (const skillId of selection.selectedSkillIds) {
      const skill = await findSkill(skillId, registryRoot);
      if (!skill) throw new Error(`Skill not found: ${skillId}`);
      selectedSkills.push(skill);
      for (const targetAgent of targetAgents) {
        const adapter = getAdapter(targetAgent);
        plans.push(await adapter.planInstall(skill, { projectRoot, targetAgent, scope, dryRun: true, mode }));
      }
    }
    printSetupPlanSummary(plans, projectRoot);

    const confirmed = autoConfirm || await promptYesNo("Install selected skills into this project?");
    if (!confirmed) {
      console.log("Cancelled. No files were changed.");
      return;
    }

    console.log(`Installing ${selectedSkills.length} skills...`);
    const appliedPlans: InstallPlan[] = [];
    for (const skill of selectedSkills) {
      for (const targetAgent of targetAgents) {
        const adapter = getAdapter(targetAgent);
        try {
          const plan = await adapter.applyInstall(skill, { projectRoot, targetAgent, scope, dryRun: false, mode });
          appliedPlans.push(plan);
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

    console.log("");
    console.log("Wrote:");
    for (const write of appliedPlans.flatMap((plan) => plan.writes)) {
      console.log(`- ${formatProjectPath(projectRoot, write)}`);
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
    const projectRoot = typeof args.flags.project === "string" ? path.resolve(args.flags.project) : undefined;
    const targetAgent = asString(args.flags.target, "codex");
    if (runRouting && !projectRoot) throw new Error("--project is required with --run-routing.");
    const routingEval = runRouting && projectRoot
      ? await runFrontendRoutingEval(suite, { projectRoot, targetAgent })
      : undefined;
    const report = {
      ok: issues.length === 0 && (!routingEval || routingEval.failures.length === 0),
      issues,
      summary: summarizeFrontendEvalSuite(suite),
      ...(routingEval ? { routingEval } : {})
    };
    if (args.flags.json) {
      printJson(report);
    } else {
      console.log(`Frontend eval suite: ${report.summary.name}`);
      console.log(`Trigger prompts: ${report.summary.triggerPrompts.total}/${report.summary.triggerPrompts.target} seeded`);
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
      if (issues.length > 0) {
        for (const issue of issues) console.log(`Issue: ${issue}`);
      }
    }
    if (issues.length > 0) throw new Error("Frontend eval suite validation failed.");
    if (routingEval && routingEval.failures.length > 0) {
      throw new Error("Frontend routing evaluation failed.");
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
      : await adapter.applyInstall(skill, { projectRoot, targetAgent, scope, dryRun, mode });
    if (args.flags.json) {
      printJson({ plan, nextStep: dryRun ? "Re-run with --yes to apply." : "Installed and locked." });
      return;
    }
    printInstallSummary(plan, projectRoot, dryRun);
    return;
  }

  if (command === "installed" || command === "list-installed") {
    const projectRoot = path.resolve(asString(args.flags.project, args.positionals[0] ?? "."));
    const lockfile = await readLockfile(projectRoot);
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
