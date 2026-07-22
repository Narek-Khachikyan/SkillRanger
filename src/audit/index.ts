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

const normalizeText = (text: string): string => {
  let normalized = text.normalize("NFKC").toLowerCase();
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, "");
  normalized = normalized.replace(/cu`+rl/gi, "curl").replace(/wg`+et/gi, "wget");
  return normalized;
};

const suspiciousPatterns: Array<[RegExp, RiskLevel, string]> = [
  [/(curl|wget)\s+[^|;&]+[|]\s*(sh|bash)/i, "block", "remote-install-pipe"],
  [/\brm\s+-rf\b/i, "block", "destructive-command"],
  [/\bsudo\b/i, "high", "privilege-escalation"],
  [/~\/\.ssh|\.ssh\//i, "block", "ssh-access"],
  [/\bbase64\b.+\b(-d|--decode)\b.+\b(sh|bash|eval)\b/i, "block", "obfuscated-execution"],
  [/\b(launchctl|crontab|systemctl)\b|~\/\.(bashrc|zshrc|profile|bash_profile)/i, "high", "persistence-mechanism"],
  [/\b(npm|pnpm|pip|pip3|uv)\s+install\b/i, "medium", "dependency-install"],
  [/(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)|(игнорируй|не\s+следуй)\s+.*(предыдущ|прошл|выше|правил|указан)/i, "high", "prompt-injection"],
  [/(?:\b(reveal|exfiltrate|print|send|cat)\b|(?:^|[^a-zA-Z0-9_а-яА-ЯёЁ])(отправь|покажи|выведи|прочитай|извлеки)).*?(?:\.env|\b(credentials|private[\s_-]?key|secrets?|tokens?|api[\s_-]?keys?)\b|секреты|токены|api[\s_-]?ключи|учётные\s+данные)/i, "block", "secret-exfiltration-instruction"]
];

const maxRisk = (findings: AuditFinding[], fallback: RiskLevel): RiskLevel => {
  return findings.reduce((risk, finding) => (severityRank[finding.severity] > severityRank[risk] ? finding.severity : risk), fallback);
};

export const auditSkill = async (skill: RegistrySkill): Promise<AuditReport> => {
  const findings: AuditFinding[] = [];
  const files = [
    ...(await walkFiles(skill.path)).map((file) => ({ file, rel: path.relative(skill.path, file) })),
    ...(skill.sharedContracts ?? []).map((contract) => ({ file: contract.path, rel: contract.installPath })),
  ];

  for (const { file, rel } of files) {
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

    const rawText = buffer.toString("utf8");
    const text = normalizeText(rawText);
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

  const checksum = await computeSkillChecksum(skill.path, skill.sharedContracts);
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
