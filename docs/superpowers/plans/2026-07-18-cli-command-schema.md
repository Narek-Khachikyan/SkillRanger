# Declarative CLI Command Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every SkillRanger command discoverable through command-specific help, expose the package version, and reject unknown options before command execution.

**Architecture:** Add a dependency-free `src/cli/commands.ts` module containing immutable command definitions plus a discriminated invocation parser and help renderers. Keep all business handlers unchanged by normalizing aliases and returning the existing `command`, `positionals`, and `flags` shape only after discovery and option validation succeed.

**Tech Stack:** Node.js 20+, TypeScript ESM, `node:test`, `node:child_process`, existing `tsc` build.

## Global Constraints

- No new runtime dependency.
- No changes to command business logic, output JSON contracts, lifecycle persistence, registry data, or MCP behavior.
- `-h` is the only supported short option.
- `--flag=value`, bundled short flags, and new command aliases are outside scope.
- Existing `list-installed` alias remains supported and resolves to `installed`.
- Help must return before command dispatch, required-argument checks, or project mutation.
- Generated `dist` artifacts must match the updated TypeScript source.

---

### Task 1: Lock the CLI contract with failing integration tests

**Files:**
- Create: `tests/cli.help.test.ts`
- Read: `package.json`
- Execute: `src/cli/index.ts`

**Interfaces:**
- Consumes: the current source CLI process interface `node src/cli/index.ts [...args]`.
- Produces: regression coverage for root help, command help, aliases, version, and unknown-option rejection.

- [ ] **Step 1: Create the CLI process helper and canonical command matrix**

Create `tests/cli.help.test.ts` with this process boundary and exact command inventory:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const canonicalCommands = [
  "scan", "domain:list", "domain:inspect",
  "design:brief", "design:recommend-recipe", "design:observe",
  "design:validate", "design:validate-source", "design:verify",
  "design:repair", "design:compile", "recommend",
  "run:start", "run:record-read", "run:resolve-clarifications",
  "run:begin", "run:complete", "run:verify", "run:inspect",
  "run:read-next", "run:step:begin", "run:evidence:add",
  "run:step:complete", "run:skill:verify", "run:finalize",
  "setup", "audit", "validate:registry", "audit:registry",
  "lint:skills", "publish:check", "eval:visual", "eval:frontend",
  "install", "installed", "mcp", "doctor",
] as const;

const cli = (...args: string[]) => spawnSync(
  process.execPath,
  ["src/cli/index.ts", ...args],
  { cwd: process.cwd(), encoding: "utf8", input: "", timeout: 5_000 },
);
```

- [ ] **Step 2: Add root discovery and command-help assertions**

Append the following tests:

```typescript
test("root help supports no args, help, --help, and -h", () => {
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const result = cli(...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stdout, /^skillranger\n\nUsage:/);
    assert.equal(result.stderr, "");
  }
});

test("every canonical command provides non-executing command help", () => {
  for (const command of canonicalCommands) {
    const result = cli(command, "--help");
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`^skillranger ${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\n`));
    assert.match(result.stdout, /Usage:/);
    assert.equal(result.stderr, "");
  }
});

test("run:start help works through --help, -h, and help command", () => {
  for (const args of [["run:start", "--help"], ["run:start", "-h"], ["help", "run:start"]]) {
    const result = cli(...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skillranger run:start/);
    assert.doesNotMatch(result.stderr, /--target requires a value/);
  }
});

test("help never executes a command that otherwise has no required arguments", () => {
  const result = cli("scan", "--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^skillranger scan/);
  assert.doesNotMatch(result.stdout, /^Project:/m);
});
```

- [ ] **Step 3: Add alias, version, and unknown-option assertions**

Append:

```typescript
test("list-installed alias resolves to installed help", () => {
  const result = cli("list-installed", "--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^skillranger installed/);
});

test("--version prints the package version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const result = cli("--version");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, "");
});

test("unknown long and short options fail before command execution", () => {
  for (const option of ["--definitely-invalid", "-x"]) {
    const result = cli("scan", option);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Unknown option for scan: ${option.replace("-", "\\-")}`));
    assert.equal(result.stdout, "");
  }
});

test("help for an unknown command fails concisely", () => {
  const result = cli("help", "not-a-command");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^Unknown command: not-a-command\n$/);
});
```

- [ ] **Step 4: Run the new tests and verify RED**

Run:

```bash
node --test tests/cli.help.test.ts
```

Expected: FAIL because `run:start --help` still reports `--target requires a value`, `scan --help` executes scanning, `-h` and `--version` are unknown commands, and unknown options are accepted.

---

### Task 2: Implement the declarative schema and pre-dispatch parser

**Files:**
- Create: `src/cli/commands.ts`
- Modify: `src/cli/index.ts:2-187`
- Modify: `src/cli/index.ts:527-545`
- Modify: `src/cli/index.ts:1211`
- Test: `tests/cli.help.test.ts`

**Interfaces:**
- Consumes: raw `string[]` from `process.argv.slice(2)` and `packageRoot` from `src/paths.ts`.
- Produces: `parseCliInvocation(argv): CliInvocation`, `renderRootHelp(): string`, `renderCommandHelp(command): string`, and canonical commands compatible with existing handlers.

- [ ] **Step 1: Define immutable command metadata**

Create `src/cli/commands.ts` with these public types:

```typescript
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
```

Define one frozen row per canonical command using this exact option inventory. Items before `/` are boolean options; items after `/` consume a value:

```text
scan                         json /
domain:list                  json /
domain:inspect               json /
design:brief                 json / domain,user,task,surface,action,output
design:recommend-recipe      json / brief
design:observe               json / brief,base-url,command,route,output,project
design:validate              json / brief,direction
design:validate-source       semantic-tokens,json / files
design:verify                json / brief,direction,observations,capabilities,iteration
design:repair                json / report,max-iterations
design:compile               json / brief,direction,report,output
recommend                    explain,json / target,intent,capabilities,lane,limit-per-lane
run:start                    strict,store-intent,json / target,domain,intent,inputs,capabilities,brief
run:record-read              json / run,skill
run:resolve-clarifications   json / run,answers
run:begin                    json / run
run:complete                 json / run,status,artifacts
run:verify                   json / run,report
run:inspect                  json / run
run:read-next                json / run,skill
run:step:begin               json / run,skill,step
run:evidence:add             json / run,skill,step,kind,path,rules,validated-as
run:step:complete            json / run,skill,step
run:skill:verify             json / run,skill
run:finalize                 json / run
setup                        copy,yes,no-agent-context / target,intent,scope,lane,limit-per-lane
audit                        json /
validate:registry            json /
audit:registry               json /
lint:skills                  json /
publish:check                json /
eval:visual                  plan,run,prepare-review,aggregate,calibrate,dry-run,resume,json / suite,candidates,output,command,artifacts,project,timeout,plan-file,results,public-review-output,private-mapping-output,review-package,private-mapping,human-review,report,candidate
eval:frontend                json,run-tasks,summarize-variance,run-routing,dry-run,resume / suite,locale,skill-slice,repetitions,baselines,verify-task-evidence,project,target,verify-pairwise-review,command,output,filter,baseline-fixture-metadata
install                      copy,dry-run,yes,json / project,target,scope
installed                    json / project
mcp                           /
doctor                        /
```

Set `aliases: ["list-installed"]` only on `installed`. Copy the existing usage text from `printHelp` into each row's `usages`; include every documented `eval:frontend` usage variant. Give every row a concise one-sentence description.

- [ ] **Step 2: Implement lookup, parsing, and rendering helpers**

Add the following behavior to `src/cli/commands.ts`:

```typescript
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
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") return { kind: "help" };
  if (argv[0] === "help") {
    return argv[1] ? { kind: "help", command: resolveCommand(argv[1]) } : { kind: "help" };
  }
  if (argv.length === 1 && argv[0] === "--version") return { kind: "version" };

  const definition = resolveCommand(argv[0]);
  const rest = argv.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) return { kind: "help", command: definition };

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
    else { flags[key] = next; index += 1; }
  }

  return { kind: "command", command: definition.name, positionals, flags };
};
```

Implement renderers with stable output:

```typescript
export const renderRootHelp = () => [
  "skillranger",
  "",
  "Usage:",
  ...cliCommandDefinitions.flatMap((definition) => definition.usages.map((usage) => `  skillranger ${usage}`)),
  "",
  "Global options:",
  "  -h, --help  Show help",
  "  --version   Show version",
  "",
].join("\n");

export const renderCommandHelp = (definition: CliCommandDefinition) => [
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
  "",
].join("\n");
```

- [ ] **Step 3: Integrate the invocation boundary into the entrypoint**

In `src/cli/index.ts`:

1. Import `readFile` alongside `mkdir` and `writeFile`.
2. Import `parseCliInvocation`, `renderCommandHelp`, and `renderRootHelp` from `./commands.ts`.
3. Delete the local `ParsedArgs`, `parseArgs`, and static `printHelp` definitions.
4. Replace the beginning of `run()` with:

```typescript
const run = async () => {
  const invocation = parseCliInvocation(process.argv.slice(2));
  if (invocation.kind === "help") {
    console.log(invocation.command ? renderCommandHelp(invocation.command) : renderRootHelp());
    return;
  }
  if (invocation.kind === "version") {
    const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
    if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
      throw new Error("Package version is missing from package.json.");
    }
    console.log(packageJson.version);
    return;
  }

  const args = invocation;
  const command = args.command;
  const registryRoot = defaultRegistryRoot;
```

5. Change `if (command === "installed" || command === "list-installed")` to `if (command === "installed")`, because aliases are canonicalized by the parser.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test tests/cli.help.test.ts
```

Expected: all CLI help contract tests pass; no command help invocation reaches a business handler.

- [ ] **Step 5: Run existing CLI tests for parser compatibility**

Run:

```bash
node --test tests/cli.*.test.ts
```

Expected: all existing CLI tests pass. If a legitimate existing option is rejected, add that exact option to the responsible command definition rather than weakening validation.

---

### Task 3: Build distributable artifacts and verify the release surface

**Files:**
- Modify: `dist/cli/index.js`
- Modify: `dist/cli/index.d.ts`
- Create: `dist/cli/commands.js`
- Create: `dist/cli/commands.d.ts`
- Verify: all other generated `dist/**/*.js` and `dist/**/*.d.ts`

**Interfaces:**
- Consumes: the updated TypeScript CLI source and all repository tests.
- Produces: source-run and compiled-binary behavior with identical CLI discovery and validation.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
npm run check
```

Expected: exit 0 with no syntax errors.

- [ ] **Step 2: Build `dist` from source**

Run:

```bash
npm run build
```

Expected: exit 0 and generated `dist/cli/commands.js` plus declarations are present.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests pass, including `tests/cli.help.test.ts` and the package-publication test.

- [ ] **Step 4: Smoke-test the compiled binary**

Run:

```bash
node dist/cli/index.js run:start --help
node dist/cli/index.js --version
node dist/cli/index.js scan --definitely-invalid
```

Expected: command help exits 0 without a lifecycle error; version prints `0.1.2`; the final command exits 1 with `Unknown option for scan: --definitely-invalid` and no scan output.

- [ ] **Step 5: Inspect the final diff and preserve unrelated files**

Run:

```bash
git diff --check
git status --short
git diff -- src/cli/commands.ts src/cli/index.ts tests/cli.help.test.ts dist/cli/commands.js dist/cli/commands.d.ts dist/cli/index.js dist/cli/index.d.ts
```

Expected: only the planned source, test, generated distribution, specification, and plan files are part of this work; existing `.pnpm-store` files remain unstaged.

- [ ] **Step 6: Commit the implementation intentionally**

Run:

```bash
git add src/cli/commands.ts src/cli/index.ts tests/cli.help.test.ts dist/cli/commands.js dist/cli/commands.d.ts dist/cli/index.js dist/cli/index.d.ts
git commit -m "fix: add declarative CLI command help"
```

Expected: the implementation commit contains no `.pnpm-store` files or unrelated workspace changes.
