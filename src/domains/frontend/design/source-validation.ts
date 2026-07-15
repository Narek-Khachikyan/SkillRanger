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

const utilityPrefix = "(?:bg|text|border|ring|fill|stroke|grid-cols|col-span|row-span|flex|gap|space-[xy]|[mp][trblxy]?|z|translate-[xy]|scale|rotate|opacity)";
const dynamicUtilityToken = new RegExp(`(?:^|:)${utilityPrefix}-\\S*__DYNAMIC__`, "i");
const completeStaticUtilityToken = new RegExp(`^(?:[^\\s:]+:)*${utilityPrefix}-[^\\s"'\\\`{}$+]+$`, "i");
const staticConditionalClasses = (expression: string) => {
  const match = /^\s*[^?]+\?\s*(["'])(.*?)\1\s*:\s*(["'])(.*?)\3\s*$/s.exec(expression);
  if (!match) return false;
  return [match[2], match[4]].every((branch) => {
    const tokens = branch.trim().split(/\s+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => completeStaticUtilityToken.test(token));
  });
};

type ParsedTemplate = {
  start: number;
  end: number;
  segments: string[];
  expressions: string[];
  nested: ParsedTemplate[];
};

const quotedEnd = (content: string, start: number, quote: "\"" | "'") => {
  for (let index = start + 1; index < content.length; index += 1) {
    if (content[index] === "\\") index += 1;
    else if (content[index] === quote) return index + 1;
  }
  return undefined;
};

const commentEnd = (content: string, start: number) => {
  if (content[start + 1] === "/") {
    const newline = content.indexOf("\n", start + 2);
    return newline === -1 ? content.length : newline;
  }
  if (content[start + 1] === "*") {
    const close = content.indexOf("*/", start + 2);
    return close === -1 ? undefined : close + 2;
  }
  return undefined;
};

function templateExpressionEnd(content: string, start: number): { end: number; nested: ParsedTemplate[] } | undefined {
  const nested: ParsedTemplate[] = [];
  let depth = 1;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\"" || character === "'") {
      const end = quotedEnd(content, index, character);
      if (end === undefined) return undefined;
      index = end - 1;
    } else if (character === "`") {
      const template = parseTemplateAt(content, index);
      if (!template) return undefined;
      nested.push(template);
      index = template.end - 1;
    } else if (character === "/" && (content[index + 1] === "/" || content[index + 1] === "*")) {
      const end = commentEnd(content, index);
      if (end === undefined) return undefined;
      index = end - 1;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return { end: index, nested };
    }
  }
  return undefined;
}

function parseTemplateAt(content: string, start: number): ParsedTemplate | undefined {
  const segments: string[] = [];
  const expressions: string[] = [];
  const nested: ParsedTemplate[] = [];
  let segmentStart = start + 1;
  for (let index = segmentStart; index < content.length; index += 1) {
    if (content[index] === "\\") {
      index += 1;
      continue;
    }
    if (content[index] === "`") {
      segments.push(content.slice(segmentStart, index));
      return { start, end: index + 1, segments, expressions, nested };
    }
    if (content[index] !== "$" || content[index + 1] !== "{") continue;
    segments.push(content.slice(segmentStart, index));
    const expressionStart = index + 2;
    const expression = templateExpressionEnd(content, expressionStart);
    if (!expression) return undefined;
    expressions.push(content.slice(expressionStart, expression.end));
    nested.push(...expression.nested);
    index = expression.end;
    segmentStart = index + 1;
  }
  return undefined;
}

const parsedTemplates = (content: string) => {
  const templates: ParsedTemplate[] = [];
  const append = (template: ParsedTemplate) => {
    templates.push(template);
    template.nested.forEach(append);
  };
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "`") continue;
    const template = parseTemplateAt(content, index);
    if (!template) continue;
    append(template);
    index = template.end - 1;
  }
  return templates;
};

const balancedDelimiterEnd = (content: string, start: number, open: string, close: string) => {
  let depth = 1;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\"" || character === "'") {
      const end = quotedEnd(content, index, character);
      if (end === undefined) return undefined;
      index = end - 1;
    } else if (character === "`") {
      const template = parseTemplateAt(content, index);
      if (!template) return undefined;
      index = template.end - 1;
    } else if (character === "/" && (content[index + 1] === "/" || content[index + 1] === "*")) {
      const end = commentEnd(content, index);
      if (end === undefined) return undefined;
      index = end - 1;
    } else if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
};

type SourceRange = { start: number; end: number };
const relevantClassExpressionRanges = (content: string) => {
  const ranges: SourceRange[] = [];
  const assignment = /\b(?:className|class)\s*=\s*/g;
  for (const match of content.matchAll(assignment)) {
    const start = (match.index ?? 0) + match[0].length;
    if (content[start] === "{") {
      const end = balancedDelimiterEnd(content, start, "{", "}");
      if (end !== undefined) ranges.push({ start: start + 1, end });
    }
  }
  const compositionCall = /\b(?:cn|clsx|classnames|classNames|twMerge|twJoin|cva)\s*\(/g;
  for (const match of content.matchAll(compositionCall)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("(");
    const end = balancedDelimiterEnd(content, open, "(", ")");
    if (end !== undefined) ranges.push({ start: open + 1, end });
  }
  return ranges;
};

type ConcatenationOperand = { end: number; value?: string };
const concatenationOperand = (content: string, start: number, end: number): ConcatenationOperand | undefined => {
  let index = start;
  while (index < end && /\s/.test(content[index])) index += 1;
  if (content[index] === "\"" || content[index] === "'") {
    const literalEnd = quotedEnd(content, index, content[index] as "\"" | "'");
    if (literalEnd === undefined || literalEnd > end) return undefined;
    return { end: literalEnd, value: content.slice(index + 1, literalEnd - 1) };
  }
  const operandStart = index;
  const delimiters: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  while (index < end) {
    const character = content[index];
    if (character === "\"" || character === "'") {
      const literalEnd = quotedEnd(content, index, character);
      if (literalEnd === undefined || literalEnd > end) return undefined;
      index = literalEnd;
      continue;
    }
    if (character === "`") {
      const template = parseTemplateAt(content, index);
      if (!template || template.end > end) return undefined;
      index = template.end;
      continue;
    }
    if (pairs[character]) delimiters.push(pairs[character]);
    else if (delimiters.at(-1) === character) delimiters.pop();
    else if (delimiters.length === 0 && (character === "," || character === ";" || character === "+")) break;
    index += 1;
  }
  return content.slice(operandStart, index).trim() === "" ? undefined : { end: index };
};

const dynamicConcatenations = (content: string) => {
  const matches: Array<{ index: number; value: string }> = [];
  const matchedStarts = new Set<number>();
  for (const range of relevantClassExpressionRanges(content)) {
    for (let start = range.start; start < range.end; start += 1) {
      if ((content[start] !== "\"" && content[start] !== "'") || matchedStarts.has(start)) continue;
      let operand = concatenationOperand(content, start, range.end);
      if (!operand?.value) continue;
      let combined = operand.value;
      let cursor = operand.end;
      let dynamic = false;
      let operators = 0;
      while (cursor < range.end) {
        while (cursor < range.end && /\s/.test(content[cursor])) cursor += 1;
        if (content[cursor] !== "+" || content[cursor + 1] === "+") break;
        operators += 1;
        operand = concatenationOperand(content, cursor + 1, range.end);
        if (!operand) break;
        if (operand.value === undefined) {
          combined += "__DYNAMIC__";
          dynamic = true;
        } else {
          combined += operand.value;
        }
        cursor = operand.end;
      }
      const unsafe = dynamic && combined.split(/\s+/).some((token) => dynamicUtilityToken.test(token));
      if (operators > 0 && unsafe) {
        matchedStarts.add(start);
        matches.push({ index: start, value: content.slice(start, cursor) });
      }
    }
  }
  return matches;
};

const dynamicTailwindFindings = (source: SourceInput) => {
  const findings: VerificationFinding[] = [];
  for (const template of parsedTemplates(source.content)) {
    const unsafe = template.expressions.some((expression, index) => {
      const left = template.segments[index].match(/\S*$/)?.[0] ?? "";
      const right = template.segments[index + 1].match(/^\S*/)?.[0] ?? "";
      if (left === "" && right === "" && staticConditionalClasses(expression)) return false;
      return dynamicUtilityToken.test(`${left}__DYNAMIC__${right}`);
    });
    if (unsafe) {
      findings.push(finding({
        code: "tailwind-dynamic-class",
        severity: "high",
        gate: "hard",
        message: "Dynamic Tailwind utility construction may be absent from generated CSS.",
        evidence: [sourceEvidence(source, template.start, source.content.slice(template.start, template.end))],
        remediation: "Map variants to complete static utility strings that Tailwind can detect.",
      }));
    }
  }
  for (const match of dynamicConcatenations(source.content)) {
    findings.push(finding({
      code: "tailwind-dynamic-class",
      severity: "high",
      gate: "hard",
      message: "Dynamic Tailwind utility construction may be absent from generated CSS.",
      evidence: [sourceEvidence(source, match.index, match.value)],
      remediation: "Map variants to complete static utility strings that Tailwind can detect.",
    }));
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
