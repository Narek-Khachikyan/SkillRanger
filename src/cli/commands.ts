export type CliCommandDefinition = Readonly<{
  name: string;
  aliases?: readonly string[];
  description: string;
  usages: readonly string[];
  booleanOptions: readonly string[];
  valueOptions: readonly string[];
}>;

export type CliInvocation =
  | Readonly<{ kind: "help"; command?: CliCommandDefinition }>
  | Readonly<{ kind: "version" }>
  | Readonly<{
      kind: "command";
      command: string;
      positionals: string[];
      flags: Record<string, string | boolean>;
    }>;

const defineCommand = (definition: CliCommandDefinition): CliCommandDefinition =>
  Object.freeze({
    ...definition,
    ...(definition.aliases ? { aliases: Object.freeze([...definition.aliases]) } : {}),
    usages: Object.freeze([...definition.usages]),
    booleanOptions: Object.freeze([...definition.booleanOptions]),
    valueOptions: Object.freeze([...definition.valueOptions]),
  });

export const cliCommandDefinitions = Object.freeze([
  defineCommand({
    name: "task",
    description: "Prepare a universal SkillRanger task in direct CLI mode.",
    usages: ["task [project] --intent <text> [--target <agent>] [--capabilities <list>] [--strict] [--explain] [--json]"],
    booleanOptions: ["strict", "explain", "json", "store-intent", "confirm-store-intent"],
    valueOptions: ["intent", "target", "capabilities", "skill-inputs", "continuation-token", "answers"],
  }),
  defineCommand({
    name: "task:read",
    description: "Read the next mandatory or selected optional router instruction file.",
    usages: ["task:read [project] --router-run <id> --expected-read-revision <n> [--mandatory-next|--skill <id> --path <path>] [--json]"],
    booleanOptions: ["mandatory-next", "json"],
    valueOptions: ["router-run", "read-request-id", "expected-read-revision", "skill", "path"],
  }),
  defineCommand({
    name: "scan",
    description: "Inspect a project and print its detected stack and agent context.",
    usages: ["scan [project] [--json]"],
    booleanOptions: ["json"],
    valueOptions: [],
  }),
  defineCommand({
    name: "domain:list",
    description: "List available SkillRanger domain packs.",
    usages: ["domain:list [--json]"],
    booleanOptions: ["json"],
    valueOptions: [],
  }),
  defineCommand({
    name: "domain:inspect",
    description: "Inspect one SkillRanger domain pack.",
    usages: ["domain:inspect <domain-id> [--json]"],
    booleanOptions: ["json"],
    valueOptions: [],
  }),
  defineCommand({
    name: "design:brief",
    description: "Create a structured frontend design brief.",
    usages: [
      "design:brief [project] [--domain <name>] [--user <actor>] [--task <task>] [--surface <type>] [--action <action>] [--output <path>] [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["domain", "user", "task", "surface", "action", "output"],
  }),
  defineCommand({
    name: "design:recommend-recipe",
    description: "Recommend frontend recipes for a design brief.",
    usages: ["design:recommend-recipe --brief <path> [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["brief"],
  }),
  defineCommand({
    name: "design:observe",
    description: "Run a browser observation adapter for a design brief.",
    usages: [
      "design:observe --brief <path> --base-url <url> --command <adapter> [--route </path>] [--output observations.json] [--project <path>] [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["brief", "base-url", "command", "route", "output", "project"],
  }),
  defineCommand({
    name: "design:validate",
    description: "Validate a design brief and optional direction.",
    usages: ["design:validate --brief <path> [--direction <path>] [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["brief", "direction"],
  }),
  defineCommand({
    name: "design:validate-source",
    description: "Validate frontend source files against design constraints.",
    usages: [
      "design:validate-source [project] --files <comma-separated-paths> [--semantic-tokens] [--json]",
    ],
    booleanOptions: ["semantic-tokens", "json"],
    valueOptions: ["files"],
  }),
  defineCommand({
    name: "design:verify",
    description: "Verify design artifacts and browser observations.",
    usages: [
      "design:verify --brief <path> --direction <path> [--observations <path>] [--capabilities browser,screenshots] [--iteration <n>] [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["brief", "direction", "observations", "capabilities", "iteration"],
  }),
  defineCommand({
    name: "design:repair",
    description: "Create a bounded repair request from a verification report.",
    usages: ["design:repair --report <path> [--max-iterations <n>] [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["report", "max-iterations"],
  }),
  defineCommand({
    name: "design:compile",
    description: "Compile validated design artifacts into a design file.",
    usages: [
      "design:compile --brief <path> --direction <path> [--report <path>] [--output <path>] [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["brief", "direction", "report", "output"],
  }),
  defineCommand({
    name: "recommend",
    description: "Recommend skills for a project and intent.",
    usages: [
      "recommend [project] [--target codex|claude-code|opencode|cursor|gemini-cli] [--intent \"...\"] [--capabilities browser,screenshots] [--lane <lane>] [--limit-per-lane <n>] [--explain] [--json]",
    ],
    booleanOptions: ["explain", "json"],
    valueOptions: ["target", "intent", "capabilities", "lane", "limit-per-lane"],
  }),
  defineCommand({
    name: "run:start",
    description: "Start a persisted skill lifecycle run.",
    usages: [
      "run:start [project] --target <agent> --domain <id> --intent <text> [--strict --inputs <path> --capabilities <list>] [--brief <path>] [--store-intent] [--json]",
    ],
    booleanOptions: ["strict", "store-intent", "json"],
    valueOptions: ["target", "domain", "intent", "inputs", "capabilities", "brief"],
  }),
  defineCommand({
    name: "run:record-read",
    description: "Record that a selected lifecycle skill was read.",
    usages: ["run:record-read [project] --run <id> --skill <id> [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["run", "skill"],
  }),
  defineCommand({
    name: "run:resolve-clarifications",
    description: "Resolve required lifecycle clarification questions.",
    usages: [
      "run:resolve-clarifications [project] --run <id> --answers <json-path> [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["run", "answers"],
  }),
  defineCommand({
    name: "run:begin",
    description: "Begin execution of a prepared lifecycle run.",
    usages: ["run:begin [project] --run <id> [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["run"],
  }),
  defineCommand({
    name: "run:complete",
    description: "Complete implementation for a lifecycle run.",
    usages: [
      "run:complete [project] --run <id> --status implemented|failed|blocked [--artifacts name=path,...] [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["run", "status", "artifacts"],
  }),
  defineCommand({
    name: "run:verify",
    description: "Verify a completed lifecycle run.",
    usages: ["run:verify [project] --run <id> --report <path> [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["run", "report"],
  }),
  defineCommand({
    name: "run:inspect",
    description: "Inspect a persisted lifecycle run.",
    usages: ["run:inspect [project] --run <id> [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["run"],
  }),
  defineCommand({
    name: "run:read-next",
    description: "Read the next required strict skill content chunk.",
    usages: ["run:read-next [project] --run <id> --skill <id> [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["run", "skill"],
  }),
  defineCommand({
    name: "run:step:begin",
    description: "Begin the next strict lifecycle step.",
    usages: [
      "run:step:begin [project] --run <id> --skill <id> --step <canonical-id> [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["run", "skill", "step"],
  }),
  defineCommand({
    name: "run:evidence:add",
    description: "Add immutable evidence to an active strict lifecycle step.",
    usages: [
      "run:evidence:add [project] --run <id> --skill <id> --step <id> --kind <kind> --path <path> [--rules <ids>] [--validated-as <schema>] [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["run", "skill", "step", "kind", "path", "rules", "validated-as"],
  }),
  defineCommand({
    name: "run:step:complete",
    description: "Complete an active strict lifecycle step.",
    usages: [
      "run:step:complete [project] --run <id> --skill <id> --step <canonical-id> [--json]",
    ],
    booleanOptions: ["json"],
    valueOptions: ["run", "skill", "step"],
  }),
  defineCommand({
    name: "run:skill:verify",
    description: "Verify one strict lifecycle skill ledger.",
    usages: ["run:skill:verify [project] --run <id> --skill <id> [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["run", "skill"],
  }),
  defineCommand({
    name: "run:finalize",
    description: "Finalize a strict lifecycle run.",
    usages: ["run:finalize [project] --run <id> [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["run"],
  }),
  defineCommand({
    name: "setup",
    description: "Interactively or explicitly install a recommended skill set.",
    usages: [
      "setup [project] [--target codex[,claude-code,opencode,cursor,gemini-cli]] [--intent \"...\"] [--scope repo|user] [--copy] [--yes] [--no-agent-context] [--lane <lane>] [--limit-per-lane <n>]",
    ],
    booleanOptions: ["copy", "yes", "no-agent-context"],
    valueOptions: ["target", "intent", "scope", "lane", "limit-per-lane"],
  }),
  defineCommand({
    name: "audit",
    description: "Audit one registry skill package.",
    usages: ["audit <skill-id> [--json]"],
    booleanOptions: ["json"],
    valueOptions: [],
  }),
  defineCommand({
    name: "validate:registry",
    description: "Validate the local skill registry.",
    usages: ["validate:registry [--json]"],
    booleanOptions: ["json"],
    valueOptions: [],
  }),
  defineCommand({
    name: "audit:registry",
    description: "Audit every skill in the local registry.",
    usages: ["audit:registry [--json]"],
    booleanOptions: ["json"],
    valueOptions: [],
  }),
  defineCommand({
    name: "lint:skills",
    description: "Lint all skill packages in the local registry.",
    usages: ["lint:skills [--json]"],
    booleanOptions: ["json"],
    valueOptions: [],
  }),
  defineCommand({
    name: "publish:check",
    description: "Run registry validation and audit publication gates.",
    usages: ["publish:check [--json]"],
    booleanOptions: ["json"],
    valueOptions: [],
  }),
  defineCommand({
    name: "eval:visual",
    description: "Plan, run, review, aggregate, or calibrate the visual benchmark.",
    usages: [
      "eval:visual --plan|--run|--prepare-review|--aggregate|--calibrate [options] [--json]",
    ],
    booleanOptions: [
      "plan",
      "run",
      "prepare-review",
      "aggregate",
      "calibrate",
      "dry-run",
      "resume",
      "json",
    ],
    valueOptions: [
      "suite",
      "candidates",
      "output",
      "command",
      "artifacts",
      "project",
      "timeout",
      "plan-file",
      "results",
      "public-review-output",
      "private-mapping-output",
      "review-package",
      "private-mapping",
      "human-review",
      "report",
      "candidate",
    ],
  }),
  defineCommand({
    name: "eval:frontend",
    description: "Inspect, run, or verify the frontend evaluation suite.",
    usages: [
      "eval:frontend [--suite <path>] [--locale en|ru|all] [--json]",
      "eval:frontend --run-tasks --skill-slice <id> --repetitions <n> [--baselines without-skill,old-skill,current-skill] [--json]",
      "eval:frontend --verify-task-evidence <path> --summarize-variance [--json]",
      "eval:frontend --run-routing --project <path> [--target codex] [--suite <path>] [--locale en|ru|all] [--json]",
      "eval:frontend --verify-task-evidence <path> [--suite <path>] [--json]",
      "eval:frontend --verify-pairwise-review <path> [--suite <path>] [--json]",
    ],
    booleanOptions: [
      "json",
      "run-tasks",
      "summarize-variance",
      "run-routing",
      "dry-run",
      "resume",
    ],
    valueOptions: [
      "suite",
      "locale",
      "skill-slice",
      "repetitions",
      "baselines",
      "verify-task-evidence",
      "project",
      "target",
      "verify-pairwise-review",
      "command",
      "output",
      "filter",
      "baseline-fixture-metadata",
    ],
  }),
  defineCommand({
    name: "install",
    description: "Plan or apply installation of one registry skill.",
    usages: [
      "install <skill-id> --project <path> [--target codex|claude-code|opencode|cursor|gemini-cli] [--scope repo|user] [--copy] [--dry-run] [--yes] [--json]",
    ],
    booleanOptions: ["copy", "dry-run", "yes", "json"],
    valueOptions: ["project", "target", "scope"],
  }),
  defineCommand({
    name: "installed",
    aliases: ["list-installed"],
    description: "List skills installed for a project.",
    usages: ["installed [project] [--project <path>] [--verify] [--json]"],
    booleanOptions: ["json", "verify"],
    valueOptions: ["project"],
  }),
  defineCommand({
    name: "verify",
    description: "Verify lockfile and file integrity for installed skills.",
    usages: ["verify [project] [--project <path>] [--skill <skill-id>] [--target <agent>] [--json]"],
    booleanOptions: ["json"],
    valueOptions: ["project", "skill", "target"],
  }),
  defineCommand({
    name: "uninstall",
    description: "Safely remove an installed skill package and update the lockfile.",
    usages: [
      "uninstall <skill-id> [--project <path>] [--target codex|claude-code|opencode|cursor|gemini-cli] [--scope repo|user] [--yes] [--json]",
    ],
    booleanOptions: ["yes", "json"],
    valueOptions: ["project", "target", "scope"],
  }),
  defineCommand({
    name: "mcp",
    description: "Start the SkillRanger stdio MCP server.",
    usages: ["mcp"],
    booleanOptions: [],
    valueOptions: [],
  }),
  defineCommand({
    name: "doctor",
    description: "Print SkillRanger runtime and registry diagnostics.",
    usages: ["doctor"],
    booleanOptions: [],
    valueOptions: [],
  }),
]);

const byName = new Map<string, CliCommandDefinition>();
for (const definition of cliCommandDefinitions) {
  byName.set(definition.name, definition);
  for (const alias of definition.aliases ?? []) byName.set(alias, definition);
}

const resolveCommand = (name: string) => {
  const definition = byName.get(name);
  if (!definition) throw new Error(`Unknown command: ${name}`);
  return definition;
};

export const parseCliInvocation = (argv: string[]): CliInvocation => {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { kind: "help" };
  }
  if (argv[0] === "help") {
    return argv[1]
      ? { kind: "help", command: resolveCommand(argv[1]) }
      : { kind: "help" };
  }
  if (argv.length === 1 && argv[0] === "--version") return { kind: "version" };

  const definition = resolveCommand(argv[0]);
  const rest = argv.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    return { kind: "help", command: definition };
  }

  const booleanOptions = new Set(definition.booleanOptions);
  const valueOptions = new Set(definition.valueOptions);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg.startsWith("-") && !arg.startsWith("--")) {
      throw new Error(`Unknown option for ${definition.name}: ${arg}`);
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    if (!booleanOptions.has(key) && !valueOptions.has(key)) {
      throw new Error(`Unknown option for ${definition.name}: ${arg}`);
    }
    if (booleanOptions.has(key)) {
      flags[key] = true;
      continue;
    }

    const next = rest[index + 1];
    if (!next || next.startsWith("-")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }

  return {
    kind: "command",
    command: definition.name,
    positionals,
    flags,
  };
};

export const renderRootHelp = () =>
  [
    "skillranger",
    "",
    "Usage:",
    ...cliCommandDefinitions.flatMap((definition) =>
      definition.usages.map((usage) => `  skillranger ${usage}`),
    ),
    "",
    "Global options:",
    "  -h, --help  Show help",
    "  --version   Show version",
  ].join("\n");

export const renderCommandHelp = (definition: CliCommandDefinition) =>
  [
    `skillranger ${definition.name}`,
    "",
    definition.description,
    "",
    "Usage:",
    ...definition.usages.map((usage) => `  skillranger ${usage}`),
    "",
    "Options:",
    ...definition.booleanOptions.map((option) => `  --${option}`),
    ...definition.valueOptions.map((option) => `  --${option} <value>`),
    "  -h, --help",
  ].join("\n");
