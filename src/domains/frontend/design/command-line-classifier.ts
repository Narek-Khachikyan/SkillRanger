import path from "node:path";

const shellFence = /```(?:sh|bash|zsh|fish|shell|console|terminal|powershell)\b/i;
const shellPrompt = /^(?:[$#]|(?:bash|zsh|sh|fish|pwsh|powershell)[>$])\s+/i;
const assignment = /^[A-Za-z_][A-Za-z0-9_]*=\S+$/;
const wrappers = new Set(["env", "sudo", "doas", "command", "builtin", "nohup", "time"]);
const wrapperOptionsWithValues = new Set([
  "-u", "-g", "-h", "-p", "-C", "-T", "-R", "-D", "--user", "--group",
  "--host", "--prompt", "--chdir", "--unset", "-f", "-o",
]);
const prohibitedExecutables = new Set([
  "git", "svn", "hg",
  "npm", "pnpm", "yarn", "bun", "npx", "deno",
  "rm", "cp", "mv", "install", "mkdir", "rmdir", "touch", "ln", "chmod", "chown",
  "curl", "wget", "ssh", "scp", "sftp", "rsync", "nc", "netcat", "ping", "dig", "host", "nslookup",
  "python", "python2", "python3", "node", "ruby", "perl", "php", "java", "javac", "go", "cargo", "rustc",
  "sh", "bash", "zsh", "fish", "dash", "ksh", "pwsh", "powershell",
  "ps", "kill", "pkill", "killall", "top", "lsof", "nohup",
  "cat", "tee", "sed", "awk", "find", "xargs", "grep", "rg", "tar", "zip", "unzip",
  "docker", "podman", "kubectl", "helm", "terraform", "ansible",
  "make", "cmake", "gradle", "mvn", "tsc", "vite", "webpack", "rollup", "esbuild",
]);
const operator = /(?:^|\s)(?:\|\||&&|\||>>?|<<?)(?:\s|$)/;

const executableName = (token: string) => path.posix.basename(token.replace(/\\/g, "/")).toLowerCase();

const tokenize = (line: string) => line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

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

export const containsProhibitedCommandLine = (value: string): boolean => {
  if (shellFence.test(value)) return true;
  return value.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (trimmed === "") return false;
    const { tokens, prompted, wrapped } = unwrapCommandPosition(trimmed);
    const executableToken = tokens[0];
    if (!executableToken) return false;
    const executable = executableName(executableToken);
    const explicitPathExecutable = /^(?:\.{0,2}[\\/]|[\\/])/.test(executableToken);
    const rawExecutable = path.posix.basename(executableToken.replace(/\\/g, "/"));
    if (prohibitedExecutables.has(executable)
      && (rawExecutable === rawExecutable.toLowerCase() || prompted || wrapped || explicitPathExecutable)) return true;

    const argumentsText = tokens.slice(1).join(" ");
    const hasFlag = tokens.slice(1).some((token) => /^--?[A-Za-z0-9]/.test(token));
    const hasPath = tokens.slice(1).some((token) => /(?:^\.{0,2}[\\/]|[\\/][^\s])/.test(token));
    const hasOperator = operator.test(` ${argumentsText} `);
    return (prompted || wrapped || explicitPathExecutable || hasFlag || hasPath)
      && /^[A-Za-z0-9_.+/-]+$/.test(executableToken)
      && (tokens.length > 1 || hasOperator);
  });
};
