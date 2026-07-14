import path from "node:path";

const shellFence = /```(?:sh|bash|zsh|fish|shell|console|terminal|powershell)\b/i;
const shellPrompt = /^(?:[$#]|(?:bash|zsh|sh|fish|pwsh|powershell)[>$])\s+/i;
const assignment = /^[A-Za-z_][A-Za-z0-9_]*=\S+$/;
const wrappers = new Set(["env", "sudo", "doas", "command", "builtin", "nohup", "time"]);
const wrapperOptionsWithValues = new Set([
  "-u", "-g", "-h", "-p", "-C", "-T", "-R", "-D", "--user", "--group",
  "--host", "--prompt", "--chdir", "--unset", "-f", "-o",
]);
const unambiguousExecutables = new Set([
  "echo", "printf", "eval", "exec", "unset", "cd", "ls",
  "rm", "cp", "mv", "mkdir", "rmdir", "touch", "ln", "chmod", "chown",
  "curl", "wget", "ssh", "scp", "sftp", "rsync", "nc", "netcat", "ping", "dig", "nslookup",
  "perl", "php", "javac", "cargo", "rustc", "deno", "npx",
  "sh", "bash", "zsh", "fish", "dash", "ksh", "pwsh", "powershell",
  "ps", "kill", "pkill", "killall", "top", "lsof",
  "cat", "tee", "sed", "awk", "xargs", "grep", "rg", "tar", "zip", "unzip",
  "docker", "podman", "kubectl", "helm", "terraform", "ansible",
  "cmake", "gradle", "mvn", "tsc", "vite", "webpack", "rollup", "esbuild",
]);
const standaloneExecutables = new Set([
  "whoami", "date", "uname", "uptime", "hostname", "id", "groups", "tty", "pwd",
  "printenv", "true", "false", "env",
]);
const vcsExecutables = new Set(["git", "hg", "svn"]);
const vcsSubcommands = new Set([
  "add", "am", "apply", "bisect", "branch", "checkout", "clone", "commit", "diff", "fetch", "grep",
  "init", "log", "merge", "mv", "pull", "push", "rebase", "reset", "restore", "revert", "rm", "show",
  "status", "stash", "switch", "tag", "worktree",
]);
const packageExecutables = new Set(["npm", "pnpm", "yarn", "bun"]);
const packageSubcommands = new Set([
  "add", "build", "ci", "create", "dev", "dlx", "exec", "init", "install", "link", "lint", "list", "ls",
  "pack", "publish", "remove", "run", "start", "test", "unlink", "uninstall", "update", "upgrade", "why",
]);
const runtimeExecutables = new Set(["node", "python", "python2", "python3", "ruby", "go", "java"]);
const runtimeSubcommands = new Map<string, Set<string>>([
  ["node", new Set(["inspect"])],
  ["go", new Set(["build", "clean", "env", "fmt", "generate", "get", "install", "list", "mod", "run", "test", "tool", "version", "vet", "work"])],
]);
const makeTargets = new Set(["all", "build", "clean", "dev", "install", "lint", "release", "test"]);
const scriptExtension = /\.(?:sh|bash|zsh|fish|py|pyw|js|mjs|cjs|ts|tsx|rb|pl|php|ps1|bat|cmd|exe)$/i;
const explicitPath = /^(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])/;
const pathArgument = /^(?:[A-Za-z]:[\\/]|\.{0,2}[\\/]|~[\\/])/;
const commandToken = /^[A-Za-z0-9_.+/-]+$/;
const hostnameQuery = /^(?:(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}|localhost|(?:\d{1,3}\.){3}\d{1,3})$/i;

const executableName = (token: string) => path.posix.basename(token.replace(/\\/g, "/")).toLowerCase();
const tokenize = (line: string) => line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

const isKnownCommandWord = (token: string) => {
  const executable = executableName(token);
  return unambiguousExecutables.has(executable) || standaloneExecutables.has(executable)
    || vcsExecutables.has(executable) || packageExecutables.has(executable)
    || runtimeExecutables.has(executable) || executable === "make" || executable === "find"
    || ["source", ".", "install", "host", "export", "alias"].includes(executable);
};

const unwrapCommandPosition = (line: string) => {
  let normalized = line.trim();
  let prompted = false;
  if (shellPrompt.test(normalized)) {
    normalized = normalized.replace(shellPrompt, "");
    prompted = true;
  }
  const tokens = tokenize(normalized);
  let wrapped = false;
  let changed = true;
  while (changed && tokens.length > 0) {
    changed = false;
    while (tokens[0] && assignment.test(tokens[0])) {
      tokens.shift();
      wrapped = true;
      changed = true;
    }
    const wrapper = tokens[0] ? executableName(tokens[0]) : "";
    if (!wrappers.has(wrapper)) continue;
    if (wrapper === "env" && tokens.length > 1
      && !tokens[1]!.startsWith("-") && !assignment.test(tokens[1]!)
      && !explicitPath.test(tokens[1]!) && !scriptExtension.test(tokens[1]!)
      && !isKnownCommandWord(tokens[1]!)) continue;
    if (wrapper === "env" && tokens.length === 1) continue;
    tokens.shift();
    wrapped = true;
    while (tokens[0]?.startsWith("-")) {
      const option = tokens.shift()!;
      if (wrapperOptionsWithValues.has(option) && tokens.length > 0) tokens.shift();
    }
    changed = true;
  }
  return { tokens, prompted, wrapped };
};

const hasFlag = (tokens: string[]) => tokens.some((token) => /^--?(?:[A-Za-z0-9]|$)/.test(token));
const hasPath = (tokens: string[]) => tokens.some((token) => pathArgument.test(token));
const hasScript = (tokens: string[]) => tokens.some((token) => scriptExtension.test(token));

const isStandaloneCommand = (executable: string, args: string[]): boolean => {
  if (!standaloneExecutables.has(executable)) return false;
  if (args.length === 0 || hasFlag(args)) return true;
  if (executable === "date") return args.some((token) => token.startsWith("+"));
  if (executable === "hostname") return args.length === 1 && hostnameQuery.test(args[0]!);
  if (executable === "id" || executable === "groups") return args.length === 1 && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(args[0]!);
  if (executable === "printenv") return args.every((token) => /^[A-Z_][A-Z0-9_]*$/.test(token));
  if (executable === "env") return args.some((token) => assignment.test(token));
  return false;
};

const isHomonymCommand = (executable: string, args: string[]): boolean => {
  if (executable === "source" || executable === ".") {
    return hasFlag(args) || hasPath(args) || hasScript(args)
      || (args.length === 1 && commandToken.test(args[0]!));
  }
  if (executable === "install") {
    return hasFlag(args) || hasPath(args) || hasScript(args)
      || (args.length === 2 && args.every((token) => commandToken.test(token)));
  }
  if (executable === "host") return hasFlag(args) || (args.length === 1 && hostnameQuery.test(args[0]!));
  if (executable === "export" || executable === "alias") {
    return hasFlag(args) || args.some((token) => assignment.test(token));
  }
  return false;
};

const isAmbiguousCommand = (executable: string, args: string[]): boolean => {
  const first = args[0]?.toLowerCase() ?? "";
  if (vcsExecutables.has(executable)) {
    return hasFlag(args) || hasPath(args) || vcsSubcommands.has(first);
  }
  if (packageExecutables.has(executable)) {
    return hasFlag(args) || hasPath(args) || hasScript(args) || packageSubcommands.has(first)
      || args.some((token) => /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(token));
  }
  if (runtimeExecutables.has(executable)) {
    return hasFlag(args) || hasPath(args) || hasScript(args)
      || (runtimeSubcommands.get(executable)?.has(first) ?? false);
  }
  if (executable === "make") {
    return hasFlag(args) || hasPath(args) || makeTargets.has(first)
      || (args.length === 1 && /^[A-Za-z0-9_.-]+$/.test(args[0]!))
      || args.some((token) => assignment.test(token) || /[:/]/.test(token));
  }
  if (executable === "find") {
    return hasFlag(args) || hasPath(args) || first === "." || first === "..";
  }
  return false;
};

export const containsProhibitedCommandLine = (value: string): boolean => {
  if (shellFence.test(value)) return true;
  return value.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (trimmed === "") return false;
    const { tokens, prompted, wrapped } = unwrapCommandPosition(trimmed);
    const executableToken = tokens[0];
    if (!executableToken) return prompted || wrapped;
    const executable = executableName(executableToken);
    const args = tokens.slice(1);

    if (prompted || wrapped || explicitPath.test(executableToken) || scriptExtension.test(executableToken)) return true;
    if (unambiguousExecutables.has(executable)) return true;
    if (isStandaloneCommand(executable, args) || isHomonymCommand(executable, args)) return true;
    if (isAmbiguousCommand(executable, args)) return true;

    // Operator characters are intentionally not evidence: only an independently command-shaped line reaches true.
    const hasGenericEvidence = hasFlag(args) || hasPath(args) || hasScript(args);
    return commandToken.test(executableToken) && hasGenericEvidence;
  });
};
