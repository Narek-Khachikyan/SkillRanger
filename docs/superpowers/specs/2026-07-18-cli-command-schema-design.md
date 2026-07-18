# Declarative CLI Command Schema Design

## Goal

Make SkillRanger CLI discovery and argument handling predictable without adding a runtime dependency. Every supported command must have one declarative definition that drives command recognition, command-specific help, and unknown-option validation.

## Current Problem

`src/cli/index.ts` currently parses every `--name` token into an unvalidated flag map. The dispatcher recognizes help only when the first token is `help` or `--help`. Consequently:

- `skillranger run:start --help` executes the `run:start` path and fails because `--target` is missing.
- Commands that have no required arguments perform their real work when invoked with `--help`.
- `-h` and `--version` are treated as unknown commands.
- Misspelled flags are silently ignored.
- The static root help text, command recognition, and accepted flags can drift independently.

## Chosen Approach

Add a dependency-free declarative command schema to the CLI layer. Each command definition contains:

- the canonical command name;
- any aliases;
- one or more usage lines;
- the long options the command accepts;
- the options that consume a value;
- a short description suitable for command help.

The schema is the source of truth for discovery and pre-dispatch validation. Existing command handlers continue to receive the same `command`, `positionals`, and `flags` shapes, keeping the behavioral change isolated to the CLI boundary.

## Alternatives Rejected

### Global help interception only

Intercepting `--help`, `-h`, and `--version` before dispatch would fix the visible help failure but would leave misspelled flags undetected and preserve drift between help text and accepted options.

### Commander or Yargs

A third-party parser would provide mature conventions but adds a production dependency and requires a broad rewrite of the current dispatcher. The required behavior is small enough to implement clearly with the existing parser.

## CLI Contract

### Root discovery

- `skillranger`, `skillranger help`, `skillranger --help`, and `skillranger -h` print root help and exit 0.
- Root help is rendered from the declarative schema and lists every canonical command.
- `skillranger help <command>` prints help for that command and exits 0.
- `skillranger help <alias>` resolves to the canonical command and prints the canonical help.
- Help for an unknown command exits 1 with `Unknown command: <name>`.

### Command help

- `<command> --help` and `<command> -h` print only that command's help and exit 0.
- Help takes precedence over required-argument checks and unknown-option validation, so requesting help never executes a command or mutates project state.
- Additional positional or option tokens do not cause command execution when help is present.
- Command help includes all usage variants, its description, and the accepted options.

### Version

- `skillranger --version` prints the version from the repository or installed package's `package.json` and exits 0.
- Version loading uses the existing `packageRoot` path and adds no dependency.
- `--version` is a root operation; it is not accepted as a subcommand option.

### Option parsing and validation

- Existing `--flag value` syntax and boolean `--flag` syntax remain supported.
- `-h` is the only supported short option.
- Any other dash-prefixed short option exits 1 as an unknown option.
- Any long option not declared for the resolved command exits 1 before dispatch.
- Unknown-option errors identify both the option and command.
- Existing command aliases remain supported, including `list-installed` for `installed`.
- Existing handler-level validation remains authoritative for missing values, value domains, required option combinations, and lifecycle state.
- `--flag=value` syntax is outside this change and remains unsupported.

## Architecture

### Command metadata

Create a focused CLI schema module under `src/cli/` that exports immutable command definitions and lookup/rendering helpers. Keeping metadata out of the already-large dispatcher prevents further growth and lets tests exercise the schema independently if needed.

The schema must include every command currently dispatched by `src/cli/index.ts`, `src/cli/runs.ts`, and `src/cli/visual-eval.ts`. Options accepted by current implementation but omitted from the static root help must still be declared so existing invocations do not regress.

### Parse and dispatch flow

The entrypoint follows this order:

1. Recognize root no-argument help, `help`, `--help`, `-h`, and root `--version`.
2. Resolve the command or alias through the declarative schema.
3. If command help is requested, render it and return before validation or dispatch.
4. Parse long options using the definition's value-option metadata.
5. Reject unknown long and short options.
6. Dispatch using the canonical command name and the current argument shape.

Alias normalization occurs before dispatch, so handlers need only canonical command branches. `list-installed` continues to behave identically to `installed`.

### Error handling

Discovery and parse errors use the existing top-level error boundary: one concise message on stderr and exit code 1. Lifecycle command runtime errors retain their existing structured remediation behavior because they occur after successful CLI parsing.

## Testing

Add a dedicated CLI contract test file that executes the real source entrypoint through `execFile`.

Required regression cases:

- root help through no arguments, `help`, `--help`, and `-h`;
- command help through `run:start --help`, `run:start -h`, and `help run:start`;
- a no-required-argument command such as `scan --help` does not execute scanning;
- every canonical command listed by the schema accepts `--help`, exits 0, and renders its own usage;
- `--version` equals the version in `package.json`;
- an unknown long option and unknown short option exit 1 without command output;
- `list-installed --help` resolves to `installed` help;
- existing representative command parsing remains unchanged.

The full existing suite, syntax checks, TypeScript build, and fresh `dist` comparison must pass before completion.

## Compatibility and Scope

- No new runtime dependency.
- No changes to command business logic, output JSON contracts, lifecycle persistence, registry data, or MCP behavior.
- No conversion to a third-party CLI framework.
- No support for bundled short flags or `--flag=value` in this change.
- Generated `dist` artifacts are updated so the installed/package binary receives the same behavior as source-run mode.
