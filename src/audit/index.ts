import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import type { AuditFinding, AuditReport, RegistrySkill, RiskLevel } from "../types.ts";
import { computeSkillChecksum } from "../registry/index.ts";

const severityRank: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  block: 4
};

const walkFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    } else if (entry.isSymbolicLink()) {
      files.push(fullPath);
    }
  }
  return files;
};

const isBinary = (buffer: Buffer) => buffer.includes(0);

const suspiciousPatterns: Array<[RegExp, RiskLevel, string]> = [
  [/(curl|wget)\s+[^|;&]+[|]\s*(sh|bash)/i, "block", "remote-install-pipe"],
  [/\brm\s+-rf\b/i, "block", "destructive-command"],
  [/\bsudo\b/i, "high", "privilege-escalation"],
  [/~\/\.ssh|\.ssh\//i, "block", "ssh-access"],
  [/\bbase64\b.+\b(-d|--decode)\b.+\b(sh|bash|eval)\b/i, "block", "obfuscated-execution"],
  [/\blaunchctl\b|\bcrontab\b|\bsystemctl\b/i, "high", "persistence-mechanism"],
  [/\b(npm|pnpm|pip|pip3|uv)\s+install\b/i, "medium", "dependency-install"],
  [/\b(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)\b/i, "high", "prompt-injection"],
  [/\b(reveal|exfiltrate|print)\s+(secrets?|tokens?|api[_-]?keys?|credentials)\b/i, "high", "secret-exfiltration-instruction"]
];

const maxRisk = (findings: AuditFinding[], fallback: RiskLevel): RiskLevel => {
  return findings.reduce((risk, finding) => (severityRank[finding.severity] > severityRank[risk] ? finding.severity : risk), fallback);
};

export const auditSkill = async (skill: RegistrySkill): Promise<AuditReport> => {
  const findings: AuditFinding[] = [];
  const files = await walkFiles(skill.path);

  for (const file of files) {
    const rel = path.relative(skill.path, file);
    const parts = rel.split(path.sep);
    const fileStat = await lstat(file);

    if (fileStat.isSymbolicLink()) {
      let target = "";
      try {
        target = await readlink(file);
      } catch {
        target = "unreadable target";
      }
      findings.push({
        severity: "block",
        code: "symlink",
        message: `Skill package contains a symlink (${target}); MVP packages must be plain files/directories.`,
        path: rel
      });
      continue;
    }

    if (parts.some((part) => part.startsWith(".") && part !== ".")) {
      findings.push({
        severity: rel.includes(".env") || rel.includes(".ssh") ? "block" : "high",
        code: "hidden-file",
        message: "Skill package contains a hidden file or folder.",
        path: rel
      });
    }

    const buffer = await readFile(file);
    if (isBinary(buffer)) {
      findings.push({
        severity: "high",
        code: "binary-file",
        message: "Skill package contains a binary file.",
        path: rel
      });
      continue;
    }

    const text = buffer.toString("utf8");
    for (const [pattern, severity, code] of suspiciousPatterns) {
      if (pattern.test(text)) {
        findings.push({
          severity,
          code,
          message: `Suspicious command pattern detected: ${code}.`,
          path: rel
        });
      }
    }
  }

  if (skill.manifest.scripts.length > 0) {
    findings.push({
      severity: "medium",
      code: "scripts-present",
      message: "Skill declares scripts; MVP installer must not execute them."
    });
  }

  if (skill.manifest.permissions.network) {
    findings.push({
      severity: "medium",
      code: "network-permission",
      message: "Skill declares network access."
    });
  }

  const checksum = await computeSkillChecksum(skill.path);
  const riskLevel = maxRisk(findings, skill.manifest.riskLevel);
  const securityScore = Math.max(0.05, Number((skill.manifest.securityScore - findings.length * 0.12 - (riskLevel === "block" ? 0.5 : 0)).toFixed(2)));

  return {
    skillId: skill.manifest.id,
    checksum,
    riskLevel,
    securityScore,
    findings
  };
};
