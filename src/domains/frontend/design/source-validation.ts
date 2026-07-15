import { readFile } from "node:fs/promises";
import path from "node:path";
import type { VerificationFinding } from "../../../runtime/types.ts";

type SourceInput = {
  path: string;
  content: string;
};

const finding = (input: {
  code: string;
  severity: VerificationFinding["severity"];
  gate: VerificationFinding["gate"];
  message: string;
  evidence: string[];
  remediation: string;
}): VerificationFinding => ({
  id: `${input.code}:${input.evidence[0] ?? "source"}`,
  source: "frontend.source-validator",
  autofixable: false,
  affectedSurface: input.evidence[0],
  ...input,
});

const lineNumber = (content: string, index: number) =>
  content.slice(0, index).split("\n").length;

const sourceEvidence = (source: SourceInput, index: number, snippet: string) =>
  `${source.path}:${lineNumber(source.content, index)} ${snippet.trim()}`;

const dynamicTailwindFindings = (source: SourceInput) => {
  const findings: VerificationFinding[] = [];
  const patterns = [
    /(?:className|class)\s*=\s*\{?`[^`]*\$\{[^}]+\}[^`]*`/g,
    /(?:className|class)\s*=\s*\{?['"][^'"]*['"]\s*\+\s*[^}\n]+/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.content.matchAll(pattern)) {
      const value = match[0];
      if (!/(?:^|[\s"'`])(?:bg|text|border|ring|fill|stroke|grid-cols|col-span|row-span|flex|gap|space-[xy]|[mp][trblxy]?|z|translate-[xy]|scale|rotate|opacity)-/i.test(value)) continue;
      findings.push(finding({
        code: "tailwind-dynamic-class",
        severity: "high",
        gate: "hard",
        message: "Dynamic Tailwind utility construction may be absent from generated CSS.",
        evidence: [sourceEvidence(source, match.index ?? 0, value)],
        remediation: "Map variants to complete static utility strings that Tailwind can detect.",
      }));
    }
  }
  return findings;
};

const conflictingUtilityFindings = (source: SourceInput) => {
  const findings: VerificationFinding[] = [];
  const classLiteral = /(?:className|class)\s*=\s*["'`]([^"'`]+)["'`]/g;
  const groups: Array<[string, RegExp]> = [
    ["display", /^(?:block|inline|inline-block|flex|inline-flex|grid|hidden)$/],
    ["position", /^(?:static|fixed|absolute|relative|sticky)$/],
    ["width", /^(?:w|min-w|max-w)-/],
    ["height", /^(?:h|min-h|max-h)-/],
  ];
  for (const match of source.content.matchAll(classLiteral)) {
    const classes = match[1].split(/\s+/).filter(Boolean);
    for (const [group, pattern] of groups) {
      const byVariant = new Map<string, string[]>();
      for (const utility of classes) {
        const segments = utility.split(":");
        const base = segments.at(-1) ?? utility;
        if (!pattern.test(base)) continue;
        const variant = segments.slice(0, -1).join(":");
        byVariant.set(variant, [...(byVariant.get(variant) ?? []), utility]);
      }
      for (const utilities of byVariant.values()) {
        if (utilities.length < 2) continue;
        findings.push(finding({
          code: "tailwind-conflicting-utilities",
          severity: "medium",
          gate: "soft",
          message: `Potential conflicting ${group} utilities occur in one static class list.`,
          evidence: [sourceEvidence(source, match.index ?? 0, utilities.join(" "))],
          remediation: "Remove the unintended utility or make the state/breakpoint precedence explicit.",
        }));
      }
    }
  }
  return findings;
};

const tokenDriftFindings = (source: SourceInput, semanticTokensPresent: boolean) => {
  if (!semanticTokensPresent) return [];
  const findings: VerificationFinding[] = [];
  const rawColor = /(?:#[0-9a-fA-F]{3,8}|(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})/g;
  for (const match of source.content.matchAll(rawColor)) {
    findings.push(finding({
      code: "design-system-raw-color",
      severity: "medium",
      gate: "soft",
      message: "A raw color bypasses an available semantic token system.",
      evidence: [sourceEvidence(source, match.index ?? 0, match[0])],
      remediation: "Use the local semantic color role or document why this product-specific value is intentionally local.",
    }));
  }
  return findings;
};

const genericityFindings = (source: SourceInput) => {
  const findings: VerificationFinding[] = [];
  const genericPatterns: Array<[string, RegExp, string]> = [
    ["generic-gradient-blob", /(?:gradient|blur-3xl|rounded-full)[^\n]{0,80}(?:absolute|opacity-\d+)/gi, "Decorative gradient/blob treatment needs product justification."],
    ["generic-testimonial-copy", /(?:what our customers say|trusted by thousands|loved by teams|testimonial)/gi, "Testimonial-style copy must come from supplied product evidence."],
    ["generic-fake-metric", /(?:\+\d+%|\d+x faster|10,?000\+ users|99\.9% uptime)/gi, "Metric-like copy must be supplied or explicitly synthetic."],
  ];
  for (const [code, pattern, message] of genericPatterns) {
    for (const match of source.content.matchAll(pattern)) {
      findings.push(finding({
        code,
        severity: "medium",
        gate: "soft",
        message,
        evidence: [sourceEvidence(source, match.index ?? 0, match[0])],
        remediation: "Remove the generic element or tie it to observed product content, state, or workflow evidence.",
      }));
    }
  }
  return findings;
};

export const validateFrontendSources = (
  sources: SourceInput[],
  options: { semanticTokensPresent?: boolean } = {},
) => sources.flatMap((source) => [
  ...dynamicTailwindFindings(source),
  ...conflictingUtilityFindings(source),
  ...tokenDriftFindings(source, options.semanticTokensPresent ?? false),
  ...genericityFindings(source),
]);

export const validateFrontendSourceFiles = async (
  filePaths: string[],
  options: { projectRoot?: string; semanticTokensPresent?: boolean } = {},
) => {
  const projectRoot = path.resolve(options.projectRoot ?? ".");
  const sources = await Promise.all(filePaths.map(async (filePath) => {
    const resolved = path.resolve(projectRoot, filePath);
    if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
      throw new Error(`Source path escapes project root: ${filePath}`);
    }
    return {
      path: path.relative(projectRoot, resolved) || path.basename(resolved),
      content: await readFile(resolved, "utf8"),
    };
  }));
  return validateFrontendSources(sources, options);
};
