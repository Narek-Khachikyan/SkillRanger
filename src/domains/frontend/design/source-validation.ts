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
  expressionRanges: SourceRange[];
  nested: ParsedTemplate[];
};
type SourceRange = { start: number; end: number };
type ScanFailure = SourceRange & { reason: string };
type BalancedScan = { end: number; nested: ParsedTemplate[]; failure?: undefined } | { failure: ScanFailure };

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

const regexLiteralEnd = (content: string, start: number) => {
  let inCharacterClass = false;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\n" || character === "\r") return undefined;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") inCharacterClass = true;
    else if (character === "]") inCharacterClass = false;
    else if (character === "/" && !inCharacterClass) {
      index += 1;
      while (/[a-z]/i.test(content[index] ?? "")) index += 1;
      return index;
    }
  }
  return undefined;
};

const controlHeadKeywords = new Set(["if", "while", "for", "with", "switch", "catch"]);
const statementPrefixKeywords = new Set(["else", "do"]);
const expressionPrefixKeywords = new Set(["return", "throw", "case", "delete", "void", "typeof", "instanceof", "in", "of", "yield", "await"]);
const regexPrefixPunctuation = new Set(["{", "[", ";", ",", "?", ":", "=", "+", "-", "*", "%", "&", "|", "^", "!", "~", "<", ">", "/"]);
const valueSuffixPunctuation = new Set(["}", "]", "."]);

const scanFailure = (content: string, start: number, reason: string): ScanFailure => {
  const newline = content.indexOf("\n", start);
  return { start, end: newline === -1 ? content.length : newline, reason };
};

type LexicalItem = { end: number; kind: "comment" | "value"; template?: ParsedTemplate; failure?: undefined } | { failure: ScanFailure } | undefined;
function lexicalItemAt(content: string, index: number, regexAllowed: boolean): LexicalItem {
  const character = content[index];
  if (character === "\"" || character === "'") {
    const end = quotedEnd(content, index, character);
    return end === undefined ? { failure: scanFailure(content, index, "unterminated string") } : { end, kind: "value" };
  }
  if (character === "`") {
    const template = parseTemplateAt(content, index);
    return template ? { end: template.end, kind: "value", template } : { failure: scanFailure(content, index, "unparseable template") };
  }
  if (character !== "/") return undefined;
  if (content[index + 1] === "/" || content[index + 1] === "*") {
    const end = commentEnd(content, index);
    return end === undefined ? { failure: scanFailure(content, index, "unterminated comment") } : { end, kind: "comment" };
  }
  if (!regexAllowed) return undefined;
  const end = regexLiteralEnd(content, index);
  return end === undefined ? { failure: scanFailure(content, index, "unterminated regular expression") } : { end, kind: "value" };
}

function scanBalancedDelimiter(content: string, start: number, open: string, close: string): BalancedScan {
  const nested: ParsedTemplate[] = [];
  const parenthesisControls = open === "(" ? [false] : [];
  let depth = 1;
  let index = start + 1;
  let regexAllowed = true;
  let pendingControlHead = false;
  while (index < content.length) {
    const lexical = lexicalItemAt(content, index, regexAllowed);
    if (lexical?.failure) return { failure: lexical.failure };
    if (lexical) {
      if (lexical.template) nested.push(lexical.template);
      if (lexical.kind === "value") {
        regexAllowed = false;
        pendingControlHead = false;
      }
      index = lexical.end;
      continue;
    }
    const character = content[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let end = index + 1;
      while (/[A-Za-z0-9_$]/.test(content[end] ?? "")) end += 1;
      const keyword = content.slice(index, end);
      pendingControlHead = controlHeadKeywords.has(keyword);
      regexAllowed = pendingControlHead || statementPrefixKeywords.has(keyword) || expressionPrefixKeywords.has(keyword);
      index = end;
      continue;
    }
    if (/[0-9]/.test(character)) {
      let end = index + 1;
      while (/[A-Za-z0-9_.]/.test(content[end] ?? "")) end += 1;
      pendingControlHead = false;
      regexAllowed = false;
      index = end;
      continue;
    }
    if ((character === "+" || character === "-") && content[index + 1] === character) {
      const postfix = !regexAllowed;
      pendingControlHead = false;
      regexAllowed = !postfix;
      index += 2;
      continue;
    }
    if (character === "(") {
      parenthesisControls.push(pendingControlHead);
      pendingControlHead = false;
      regexAllowed = true;
      if (open === "(") depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      const closedControlHead = parenthesisControls.pop() ?? false;
      if (close === ")") {
        depth -= 1;
        if (depth === 0) return { end: index, nested };
      }
      pendingControlHead = false;
      regexAllowed = closedControlHead;
      index += 1;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return { end: index, nested };
    }
    if (character === "\\") return { failure: scanFailure(content, index, "unexpected escape outside lexical value") };
    pendingControlHead = false;
    if (regexPrefixPunctuation.has(character)) regexAllowed = true;
    else if (valueSuffixPunctuation.has(character)) regexAllowed = false;
    index += 1;
  }
  return { failure: scanFailure(content, start, `unterminated ${open}${close} expression`) };
}

function templateExpressionEnd(content: string, start: number): { end: number; nested: ParsedTemplate[] } | undefined {
  const scanned = scanBalancedDelimiter(content, start - 1, "{", "}");
  return scanned.failure ? undefined : { end: scanned.end, nested: scanned.nested };
}

function parseTemplateAt(content: string, start: number): ParsedTemplate | undefined {
  const segments: string[] = [];
  const expressions: string[] = [];
  const expressionRanges: SourceRange[] = [];
  const nested: ParsedTemplate[] = [];
  let segmentStart = start + 1;
  for (let index = segmentStart; index < content.length; index += 1) {
    if (content[index] === "\\") {
      index += 1;
      continue;
    }
    if (content[index] === "`") {
      segments.push(content.slice(segmentStart, index));
      return { start, end: index + 1, segments, expressions, expressionRanges, nested };
    }
    if (content[index] !== "$" || content[index + 1] !== "{") continue;
    segments.push(content.slice(segmentStart, index));
    const expressionStart = index + 2;
    const expression = templateExpressionEnd(content, expressionStart);
    if (!expression) return undefined;
    expressions.push(content.slice(expressionStart, expression.end));
    expressionRanges.push({ start: expressionStart, end: expression.end });
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

type LexicalScope = SourceRange & { id: number; parent?: number; depth: number };
type LocalInitializer = SourceRange & { name: string; scope: number };
type ClassValueRange = SourceRange & { kind: "expression" | "arguments" };

const opaqueLexicalRanges = (content: string) => {
  const ranges: SourceRange[] = [];
  const scan = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      const character = content[index];
      if (character === "\"" || character === "'") {
        const lexicalEnd = quotedEnd(content, index, character);
        if (lexicalEnd === undefined || lexicalEnd > end) return;
        ranges.push({ start: index, end: lexicalEnd });
        index = lexicalEnd - 1;
        continue;
      }
      if (character === "`") {
        const template = parseTemplateAt(content, index);
        if (!template || template.end > end) return;
        let quasiStart = template.start;
        for (const expression of template.expressionRanges) {
          ranges.push({ start: quasiStart, end: expression.start });
          scan(expression.start, expression.end);
          quasiStart = expression.end;
        }
        ranges.push({ start: quasiStart, end: template.end });
        index = template.end - 1;
        continue;
      }
      if (character === "/" && (content[index + 1] === "/" || content[index + 1] === "*")) {
        const lexicalEnd = commentEnd(content, index);
        if (lexicalEnd === undefined || lexicalEnd > end) return;
        ranges.push({ start: index, end: lexicalEnd });
        index = lexicalEnd - 1;
      }
    }
  };
  scan(0, content.length);
  return ranges;
};

const insideRange = (index: number, ranges: SourceRange[]) =>
  ranges.some(({ start, end }) => index >= start && index < end);

const lexicalCode = (content: string, opaque: SourceRange[]) => [...content]
  .map((character, index) => insideRange(index, opaque) && character !== "\n" && character !== "\r" ? " " : character)
  .join("");

const lexicalScopes = (code: string) => {
  const scopes: LexicalScope[] = [{ id: 0, start: 0, end: code.length, depth: 0 }];
  const stack = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === "{") {
      const parent = stack.at(-1) ?? 0;
      const scope = { id: scopes.length, parent, start: index, end: code.length, depth: scopes[parent].depth + 1 };
      scopes.push(scope);
      stack.push(scope.id);
    } else if (code[index] === "}" && stack.length > 1) {
      const scope = scopes[stack.pop() as number];
      scope.end = index + 1;
    }
  }
  return scopes;
};

const scopeAt = (index: number, scopes: LexicalScope[]) => scopes.reduce((selected, scope) =>
  index > scope.start && index < scope.end && scope.depth > selected.depth ? scope : selected, scopes[0]);

const initializerEnd = (content: string, start: number) => {
  const delimiters: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\"" || character === "'") {
      const end = quotedEnd(content, index, character);
      if (end === undefined) return undefined;
      index = end - 1;
      continue;
    }
    if (character === "`") {
      const template = parseTemplateAt(content, index);
      if (!template) return undefined;
      index = template.end - 1;
      continue;
    }
    if (character === "/" && (content[index + 1] === "/" || content[index + 1] === "*")) {
      const end = commentEnd(content, index);
      if (end === undefined) return undefined;
      index = end - 1;
      continue;
    }
    if (pairs[character]) delimiters.push(pairs[character]);
    else if (delimiters.at(-1) === character) delimiters.pop();
    else if (delimiters.length === 0 && (character === ";" || character === ",")) return index;
    else if (delimiters.length === 0 && (character === "\n" || character === "\r")) {
      const expression = content.slice(start, index).trimEnd();
      if (!/(?:[?:,+*/%&|^=!<>-]|=>)$/.test(expression)) return index;
    }
  }
  return content.length;
};

const localInitializers = (content: string, code: string, scopes: LexicalScope[]) => {
  const declarations = new Map<string, LocalInitializer[]>();
  const pattern = /\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  for (const match of code.matchAll(pattern)) {
    const declarationStart = match.index ?? 0;
    let start = declarationStart + match[0].length;
    while (/\s/.test(content[start] ?? "")) start += 1;
    const end = initializerEnd(content, start);
    if (end === undefined || content.slice(start, end).trim() === "") continue;
    const name = match[1];
    declarations.set(name, [...(declarations.get(name) ?? []), {
      name,
      start,
      end,
      scope: scopeAt(declarationStart, scopes).id,
    }]);
  }
  return declarations;
};

const trimmedRange = (code: string, range: SourceRange): SourceRange => {
  let { start, end } = range;
  while (start < end && /\s/.test(code[start])) start += 1;
  while (end > start && /\s/.test(code[end - 1])) end -= 1;
  return { start, end };
};

const topLevelSegments = (code: string, range: SourceRange, separator: string) => {
  const segments: SourceRange[] = [];
  const delimiters: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  let start = range.start;
  for (let index = range.start; index < range.end; index += 1) {
    const character = code[index];
    if (pairs[character]) delimiters.push(pairs[character]);
    else if (delimiters.at(-1) === character) delimiters.pop();
    else if (delimiters.length === 0 && character === separator) {
      segments.push({ start, end: index });
      start = index + 1;
    }
  }
  segments.push({ start, end: range.end });
  return segments;
};

const conditionalBranches = (code: string, range: SourceRange) => {
  const delimiters: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  let question: number | undefined;
  let nested = 0;
  for (let index = range.start; index < range.end; index += 1) {
    const character = code[index];
    if (pairs[character]) delimiters.push(pairs[character]);
    else if (delimiters.at(-1) === character) delimiters.pop();
    else if (delimiters.length === 0 && character === "?" && code[index + 1] !== "?" && code[index - 1] !== "?") {
      if (question === undefined) question = index;
      else nested += 1;
    } else if (delimiters.length === 0 && character === ":" && question !== undefined) {
      if (nested > 0) nested -= 1;
      else return [{ start: question + 1, end: index }, { start: index + 1, end: range.end }];
    }
  }
  return undefined;
};

const identifierKeywords = new Set([
  "const", "let", "var", "return", "true", "false", "null", "undefined", "new", "typeof", "void", "await", "yield",
]);

const referencedIdentifiers = (content: string, code: string, input: ClassValueRange) => {
  const identifiers: string[] = [];
  const visit = (rawRange: SourceRange, kind: ClassValueRange["kind"] = "expression") => {
    let range = trimmedRange(code, rawRange);
    if (range.start >= range.end) return;
    if (kind === "arguments") {
      topLevelSegments(code, range, ",").forEach((segment) => visit(segment));
      return;
    }
    while (code[range.start] === "(") {
      const scanned = scanBalancedDelimiter(content, range.start, "(", ")");
      if (scanned.failure || scanned.end !== range.end - 1) break;
      range = trimmedRange(code, { start: range.start + 1, end: range.end - 1 });
    }
    const branches = conditionalBranches(code, range);
    if (branches) {
      branches.forEach((branch) => visit(branch));
      return;
    }
    const call = /^(?:cn|clsx|classnames|classNames|twMerge|twJoin|cva)\s*\(/.exec(code.slice(range.start, range.end));
    if (call) {
      const open = range.start + call[0].lastIndexOf("(");
      const scanned = scanBalancedDelimiter(content, open, "(", ")");
      if (!scanned.failure && scanned.end === range.end - 1) {
        visit({ start: open + 1, end: scanned.end }, "arguments");
        return;
      }
    }
    for (let index = range.start; index < range.end; index += 1) {
      if (!/[A-Za-z_$]/.test(code[index])) continue;
      let end = index + 1;
      while (/[A-Za-z0-9_$]/.test(code[end] ?? "")) end += 1;
      let previous = index - 1;
      while (previous >= range.start && /\s/.test(code[previous])) previous -= 1;
      const name = content.slice(index, end);
      if (code[previous] !== "." && !identifierKeywords.has(name)) identifiers.push(name);
      index = end - 1;
    }
  };
  visit(input, input.kind);
  return identifiers;
};

const traceClassValueRanges = (content: string, seeds: ClassValueRange[]) => {
  const opaque = opaqueLexicalRanges(content);
  const code = lexicalCode(content, opaque);
  const scopes = lexicalScopes(code);
  const declarations = localInitializers(content, code, scopes);
  const ranges: SourceRange[] = [...seeds];
  const failures: ScanFailure[] = [];
  const states = new Map<number, "visiting" | "done">();
  const isAncestor = (candidate: number, origin: number) => {
    for (let scope: LexicalScope | undefined = scopes[origin]; scope; scope = scope.parent === undefined ? undefined : scopes[scope.parent]) {
      if (scope.id === candidate) return true;
    }
    return false;
  };
  const resolve = (name: string, origin: SourceRange) => {
    const originScope = scopeAt(origin.start, scopes);
    const candidates = (declarations.get(name) ?? [])
      .filter((candidate) => isAncestor(candidate.scope, originScope.id))
      .sort((left, right) => scopes[right.scope].depth - scopes[left.scope].depth);
    if (candidates.length === 0) return;
    const nearestDepth = scopes[candidates[0].scope].depth;
    const nearest = candidates.filter((candidate) => scopes[candidate.scope].depth === nearestDepth);
    if (nearest.length !== 1) {
      failures.push({ ...origin, reason: `ambiguous class value ${name}` });
      return;
    }
    const initializer = nearest[0];
    if (states.get(initializer.start) === "visiting") {
      failures.push({ ...origin, reason: `cyclic class value ${name}` });
      return;
    }
    if (states.get(initializer.start) === "done") return;
    states.set(initializer.start, "visiting");
    ranges.push(initializer);
    for (const reference of referencedIdentifiers(content, code, { ...initializer, kind: "expression" })) resolve(reference, initializer);
    states.set(initializer.start, "done");
  };
  for (const seed of seeds) {
    for (const reference of referencedIdentifiers(content, code, seed)) resolve(reference, seed);
  }
  return { ranges, failures };
};

const relevantClassExpressionRanges = (content: string) => {
  const ranges: ClassValueRange[] = [];
  const failures: ScanFailure[] = [];
  const code = lexicalCode(content, opaqueLexicalRanges(content));
  const assignment = /\b(?:className|class)\s*=/g;
  for (const match of code.matchAll(assignment)) {
    let start = (match.index ?? 0) + match[0].length;
    while (/\s/.test(content[start] ?? "")) start += 1;
    if (content[start] === "{") {
      const scanned = scanBalancedDelimiter(content, start, "{", "}");
      if (scanned.failure) failures.push(scanned.failure);
      else ranges.push({ start: start + 1, end: scanned.end, kind: "expression" });
    }
  }
  const compositionCall = /\b(?:cn|clsx|classnames|classNames|twMerge|twJoin|cva)\s*\(/g;
  for (const match of code.matchAll(compositionCall)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("(");
    const scanned = scanBalancedDelimiter(content, open, "(", ")");
    if (scanned.failure) failures.push(scanned.failure);
    else ranges.push({ start: open + 1, end: scanned.end, kind: "arguments" });
  }
  const traced = traceClassValueRanges(content, ranges);
  return { ranges: traced.ranges, failures: [...failures, ...traced.failures] };
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

const dynamicConcatenations = (content: string, ranges: SourceRange[]) => {
  const matches: Array<{ index: number; value: string }> = [];
  const matchedStarts = new Set<number>();
  for (const range of ranges) {
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
  const classAnalysis = relevantClassExpressionRanges(source.content);
  for (const failure of classAnalysis.failures) {
    findings.push(finding({
      code: "tailwind-dynamic-class",
      severity: "high",
      gate: "hard",
      message: "A class-relevant expression could not be parsed safely.",
      evidence: [sourceEvidence(source, failure.start, source.content.slice(failure.start, failure.end))],
      remediation: "Use complete static utility strings or simplify the class expression so it can be verified.",
    }));
  }
  for (const template of parsedTemplates(source.content)) {
    const classRelevant = classAnalysis.ranges.some(({ start, end }) => template.start >= start && template.end <= end);
    if (!classRelevant) continue;
    const unsafe = template.expressions.some((expression, index) => {
      const left = template.segments[index].match(/\S*$/)?.[0] ?? "";
      const right = template.segments[index + 1].match(/^\S*/)?.[0] ?? "";
      if (left === "" && right === "") return !staticConditionalClasses(expression);
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
  for (const match of dynamicConcatenations(source.content, classAnalysis.ranges)) {
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
