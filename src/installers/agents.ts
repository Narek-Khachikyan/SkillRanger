import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type AgentType =
  | "claude-code"
  | "codex"
  | "cursor"
  | "gemini-cli"
  | "generic-agent-skills"
  | "opencode"
  | "universal";

export type AgentConfig = {
  name: AgentType;
  displayName: string;
  skillsDir: string;
  globalSkillsDir?: string;
  detectInstalled(): Promise<boolean>;
};

const home = os.homedir();
const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
const codexHome = process.env.CODEX_HOME?.trim() || path.join(home, ".codex");
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");

export const agents: Record<AgentType, AgentConfig> = {
  "claude-code": {
    name: "claude-code",
    displayName: "Claude Code",
    skillsDir: ".claude/skills",
    globalSkillsDir: path.join(claudeHome, "skills"),
    detectInstalled: async () => existsSync(claudeHome)
  },
  codex: {
    name: "codex",
    displayName: "Codex",
    skillsDir: ".agents/skills",
    globalSkillsDir: path.join(codexHome, "skills"),
    detectInstalled: async () => existsSync(codexHome) || existsSync("/etc/codex")
  },
  cursor: {
    name: "cursor",
    displayName: "Cursor",
    skillsDir: ".agents/skills",
    globalSkillsDir: path.join(home, ".cursor/skills"),
    detectInstalled: async () => existsSync(path.join(home, ".cursor"))
  },
  "gemini-cli": {
    name: "gemini-cli",
    displayName: "Gemini CLI",
    skillsDir: ".agents/skills",
    globalSkillsDir: path.join(home, ".gemini/skills"),
    detectInstalled: async () => existsSync(path.join(home, ".gemini"))
  },
  "generic-agent-skills": {
    name: "generic-agent-skills",
    displayName: "Generic Agent Skills",
    skillsDir: ".agents/skills",
    globalSkillsDir: path.join(configHome, "agents/skills"),
    detectInstalled: async () => false
  },
  opencode: {
    name: "opencode",
    displayName: "OpenCode",
    skillsDir: ".agents/skills",
    globalSkillsDir: path.join(configHome, "opencode/skills"),
    detectInstalled: async () => existsSync(path.join(configHome, "opencode"))
  },
  universal: {
    name: "universal",
    displayName: "Universal",
    skillsDir: ".agents/skills",
    globalSkillsDir: path.join(configHome, "agents/skills"),
    detectInstalled: async () => false
  }
};

export const getAgentConfig = (type: string): AgentConfig => {
  const agent = agents[type as AgentType];
  if (!agent) throw new Error(`Unsupported target agent: ${type}`);
  return agent;
};

export const isUniversalAgent = (type: string) => getAgentConfig(type).skillsDir === ".agents/skills";

export const detectInstalledAgents = async (): Promise<AgentType[]> => {
  const results = await Promise.all(
    Object.entries(agents).map(async ([type, config]) => ({
      type: type as AgentType,
      installed: await config.detectInstalled()
    }))
  );
  return results.filter((result) => result.installed).map((result) => result.type);
};
