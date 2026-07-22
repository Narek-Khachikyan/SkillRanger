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

export const setupAgentTypes = [
  "claude-code",
  "codex",
  "opencode",
  "cursor",
  "gemini-cli",
] as const satisfies readonly AgentType[];

export type SetupAgentType = (typeof setupAgentTypes)[number];

export type AgentConfig = {
  name: AgentType;
  displayName: string;
  skillsDir: string;
  globalSkillsDir?: string;
  detectInstalled(): Promise<boolean>;
};

const getHome = () => os.homedir();
const getConfigHome = () => process.env.XDG_CONFIG_HOME?.trim() || path.join(getHome(), ".config");
const getCodexHome = () => process.env.CODEX_HOME?.trim() || path.join(getHome(), ".codex");
const getClaudeHome = () => process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(getHome(), ".claude");

export const agents: Record<AgentType, AgentConfig> = {
  "claude-code": {
    name: "claude-code",
    displayName: "Claude Code",
    skillsDir: ".claude/skills",
    get globalSkillsDir() {
      return path.join(getClaudeHome(), "skills");
    },
    detectInstalled: async () => existsSync(getClaudeHome())
  },
  codex: {
    name: "codex",
    displayName: "Codex",
    skillsDir: ".agents/skills",
    get globalSkillsDir() {
      return path.join(getCodexHome(), "skills");
    },
    detectInstalled: async () => existsSync(getCodexHome()) || existsSync("/etc/codex")
  },
  cursor: {
    name: "cursor",
    displayName: "Cursor",
    skillsDir: ".agents/skills",
    get globalSkillsDir() {
      return path.join(getHome(), ".cursor/skills");
    },
    detectInstalled: async () => existsSync(path.join(getHome(), ".cursor"))
  },
  "gemini-cli": {
    name: "gemini-cli",
    displayName: "Gemini CLI",
    skillsDir: ".agents/skills",
    get globalSkillsDir() {
      return path.join(getHome(), ".gemini/skills");
    },
    detectInstalled: async () => existsSync(path.join(getHome(), ".gemini"))
  },
  "generic-agent-skills": {
    name: "generic-agent-skills",
    displayName: "Generic Agent Skills",
    skillsDir: ".agents/skills",
    get globalSkillsDir() {
      return path.join(getConfigHome(), "agents/skills");
    },
    detectInstalled: async () => false
  },
  opencode: {
    name: "opencode",
    displayName: "OpenCode",
    skillsDir: ".agents/skills",
    get globalSkillsDir() {
      return path.join(getConfigHome(), "opencode/skills");
    },
    detectInstalled: async () => existsSync(path.join(getConfigHome(), "opencode"))
  },
  universal: {
    name: "universal",
    displayName: "Universal",
    skillsDir: ".agents/skills",
    get globalSkillsDir() {
      return path.join(getConfigHome(), "agents/skills");
    },
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
