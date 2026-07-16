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

type LexicalValue = {
  start: number;
  end: number;
  kind: "comment" | "value";
  type: "comment" | "quoted" | "template" | "regex";
  template?: ParsedTemplate;
  failure?: undefined;
};
type LexicalItem = LexicalValue | { failure: ScanFailure } | undefined;
function lexicalItemAt(content: string, index: number, regexAllowed: boolean): LexicalItem {
  const character = content[index];
  if (character === "\"" || character === "'") {
    const end = quotedEnd(content, index, character);
    return end === undefined ? { failure: scanFailure(content, index, "unterminated string") } : { start: index, end, kind: "value", type: "quoted" };
  }
  if (character === "`") {
    const template = parseTemplateAt(content, index);
    return template ? { start: index, end: template.end, kind: "value", type: "template", template } : { failure: scanFailure(content, index, "unparseable template") };
  }
  if (character !== "/") return undefined;
  if (content[index + 1] === "/" || content[index + 1] === "*") {
    const end = commentEnd(content, index);
    return end === undefined ? { failure: scanFailure(content, index, "unterminated comment") } : { start: index, end, kind: "comment", type: "comment" };
  }
  if (!regexAllowed) return undefined;
  const end = regexLiteralEnd(content, index);
  return end === undefined ? { failure: scanFailure(content, index, "unterminated regular expression") } : { start: index, end, kind: "value", type: "regex" };
}

const scanLexicalRange = (
  content: string,
  start: number,
  end: number,
  options: {
    initialParenthesisControls?: boolean[];
    onLexical?: (item: LexicalValue) => void;
    onCode?: (index: number, character: string) => boolean;
  } = {},
) => {
  const parenthesisControls = [...(options.initialParenthesisControls ?? [])];
  let index = start;
  let regexAllowed = true;
  let pendingControlHead = false;
  while (index < end) {
    const lexical = lexicalItemAt(content, index, regexAllowed);
    if (lexical?.failure) return { failure: lexical.failure };
    if (lexical) {
      options.onLexical?.(lexical);
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
      if (options.onCode?.(index, character)) return { stoppedAt: index };
      index += 1;
      continue;
    }
    if (character === ")") {
      const closedControlHead = parenthesisControls.pop() ?? false;
      pendingControlHead = false;
      regexAllowed = closedControlHead;
      if (options.onCode?.(index, character)) return { stoppedAt: index };
      index += 1;
      continue;
    }
    if (character === "\\") return { failure: scanFailure(content, index, "unexpected escape outside lexical value") };
    pendingControlHead = false;
    if (regexPrefixPunctuation.has(character)) regexAllowed = true;
    else if (valueSuffixPunctuation.has(character)) regexAllowed = false;
    if (options.onCode?.(index, character)) return { stoppedAt: index };
    index += 1;
  }
  return {};
};

function scanBalancedDelimiter(content: string, start: number, open: string, close: string): BalancedScan {
  const nested: ParsedTemplate[] = [];
  let depth = 1;
  const scanned = scanLexicalRange(content, start + 1, content.length, {
    initialParenthesisControls: open === "(" ? [false] : [],
    onLexical: (lexical) => { if (lexical.template) nested.push(lexical.template); },
    onCode: (index, character) => {
      if (character === open) depth += 1;
      else if (character === close) depth -= 1;
      return depth === 0;
    },
  });
  if (scanned.failure) return { failure: scanned.failure };
  if (scanned.stoppedAt !== undefined) return { end: scanned.stoppedAt, nested };
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
type LocalValue = SourceRange & { assignedAt: number; kind: "declaration" | "assignment" };
type LocalBinding = {
  name: string;
  scope: number;
  depth: number;
  visibility?: SourceRange;
  values: LocalValue[];
};
type ClassValueRange = SourceRange & { kind: "expression" | "arguments" };

const opaqueLexicalRanges = (content: string) => {
  const ranges: SourceRange[] = [];
  const scan = (start: number, end: number) => {
    scanLexicalRange(content, start, end, {
      onLexical: (lexical) => {
        if (lexical.template) {
          const template = lexical.template;
          let quasiStart = template.start;
          for (const expression of template.expressionRanges) {
            ranges.push({ start: quasiStart, end: expression.start });
            scan(expression.start, expression.end);
            quasiStart = expression.end;
          }
          ranges.push({ start: quasiStart, end: template.end });
        } else ranges.push({ start: lexical.start, end: lexical.end });
      },
    });
  };
  scan(0, content.length);
  return ranges;
};

const insideRange = (index: number, ranges: SourceRange[]) =>
  ranges.some(({ start, end }) => index >= start && index < end);

const lexicalCode = (content: string, opaque: SourceRange[]) => [...content]
  .map((character, index) => insideRange(index, opaque) ? " " : character)
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

const initializerEnd = (code: string, start: number) => {
  const delimiters: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < code.length; index += 1) {
    const character = code[index];
    if (pairs[character]) delimiters.push(pairs[character]);
    else if (delimiters.at(-1) === character) delimiters.pop();
    else if (delimiters.length === 0 && (character === ";" || character === ",")) return index;
    else if (delimiters.length === 0 && (character === "\n" || character === "\r")) {
      const expression = code.slice(start, index).trimEnd();
      if (!/(?:[?:,+*/%&|^=!<>-]|=>)$/.test(expression)) return index;
    }
  }
  return code.length;
};

const isAncestorScope = (candidate: number, origin: number, scopes: LexicalScope[]) => {
  for (let scope: LexicalScope | undefined = scopes[origin]; scope; scope = scope.parent === undefined ? undefined : scopes[scope.parent]) {
    if (scope.id === candidate) return true;
  }
  return false;
};

const visibleBindings = (
  bindings: Map<string, LocalBinding[]>,
  name: string,
  origin: number,
  scopes: LexicalScope[],
) => {
  const originScope = scopeAt(origin, scopes);
  const candidates = (bindings.get(name) ?? [])
    .filter((binding) => binding.visibility
      ? origin >= binding.visibility.start && origin < binding.visibility.end
      : isAncestorScope(binding.scope, originScope.id, scopes))
    .sort((left, right) => right.depth - left.depth);
  if (candidates.length === 0) return [];
  return candidates.filter((candidate) => candidate.depth === candidates[0].depth);
};

const localBindings = (content: string, code: string, scopes: LexicalScope[]) => {
  const bindings = new Map<string, LocalBinding[]>();
  const declarationOperators = new Set<number>();
  const loopDeclarationBodies = new Map<number, number>();
  const addBinding = (binding: LocalBinding) => {
    bindings.set(binding.name, [...(bindings.get(binding.name) ?? []), binding]);
  };
  const addParameters = (start: number, end: number, bodyStart: number, bodyEnd?: number) => {
    const bodyScope = scopeAt(bodyStart, scopes);
    const braced = code[bodyStart - 1] === "{";
    let offset = 0;
    for (const rawParameter of code.slice(start, end).split(",")) {
      const parsed = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=([\s\S]*))?$/.exec(rawParameter);
      if (!parsed) {
        offset += rawParameter.length + 1;
        continue;
      }
      const binding: LocalBinding = {
        name: parsed[1],
        scope: bodyScope.id,
        depth: braced ? bodyScope.depth : bodyScope.depth + 1,
        ...(bodyEnd === undefined ? {} : { visibility: { start: bodyStart, end: bodyEnd } }),
        values: [],
      };
      const relativeOperator = rawParameter.indexOf("=");
      if (relativeOperator !== -1) {
        const operator = start + offset + relativeOperator;
        let valueStart = operator + 1;
        while (/\s/.test(content[valueStart] ?? "")) valueStart += 1;
        let valueEnd = start + offset + rawParameter.length;
        while (valueEnd > valueStart && /\s/.test(content[valueEnd - 1])) valueEnd -= 1;
        binding.values.push({ start: valueStart, end: valueEnd, assignedAt: operator, kind: "declaration" });
      }
      addBinding(binding);
      offset += rawParameter.length + 1;
    }
  };

  const loopHead = /\bfor\s*\(/g;
  for (const match of code.matchAll(loopHead)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("(");
    const scanned = scanBalancedDelimiter(content, open, "(", ")");
    if (scanned.failure) continue;
    let body = scanned.end + 1;
    while (/\s/.test(code[body] ?? "")) body += 1;
    if (code[body] !== "{") continue;
    for (const declaration of code.slice(open + 1, scanned.end).matchAll(/\b(?:const|let)\s+[A-Za-z_$][A-Za-z0-9_$]*\b/g)) {
      loopDeclarationBodies.set(open + 1 + (declaration.index ?? 0), body + 1);
    }
  }

  const declaration = /\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  for (const match of code.matchAll(declaration)) {
    const declarationStart = match.index ?? 0;
    const name = match[1];
    let cursor = declarationStart + match[0].length;
    while (/\s/.test(code[cursor] ?? "")) cursor += 1;
    const scope = scopeAt(loopDeclarationBodies.get(declarationStart) ?? declarationStart, scopes);
    const binding: LocalBinding = { name, scope: scope.id, depth: scope.depth, values: [] };
    if (code[cursor] === "=" && code[cursor + 1] !== "=" && code[cursor + 1] !== ">") {
      declarationOperators.add(cursor);
      let start = cursor + 1;
      while (/\s/.test(content[start] ?? "")) start += 1;
      const end = initializerEnd(code, start);
      if (content.slice(start, end).trim() !== "") {
        binding.values.push({ start, end, assignedAt: cursor, kind: "declaration" });
      }
    }
    addBinding(binding);
  }

  const functionHead = /\bfunction(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(/g;
  for (const match of code.matchAll(functionHead)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("(");
    const scanned = scanBalancedDelimiter(content, open, "(", ")");
    if (scanned.failure) continue;
    let body = scanned.end + 1;
    while (/\s/.test(code[body] ?? "")) body += 1;
    if (code[body] === "{") addParameters(open + 1, scanned.end, body + 1);
  }

  for (const match of code.matchAll(/\(/g)) {
    const open = match.index ?? 0;
    const scanned = scanBalancedDelimiter(content, open, "(", ")");
    if (scanned.failure) continue;
    let arrow = scanned.end + 1;
    while (/\s/.test(code[arrow] ?? "")) arrow += 1;
    if (code.slice(arrow, arrow + 2) !== "=>") continue;
    let body = arrow + 2;
    while (/\s/.test(code[body] ?? "")) body += 1;
    if (code[body] === "{") addParameters(open + 1, scanned.end, body + 1);
    else addParameters(open + 1, scanned.end, body, initializerEnd(code, body));
  }
  const singleArrow = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
  for (const match of code.matchAll(singleArrow)) {
    let body = (match.index ?? 0) + match[0].length;
    while (/\s/.test(code[body] ?? "")) body += 1;
    const parameterStart = (match.index ?? 0) + match[0].indexOf(match[1]);
    if (code[body] === "{") addParameters(parameterStart, parameterStart + match[1].length, body + 1);
    else addParameters(parameterStart, parameterStart + match[1].length, body, initializerEnd(code, body));
  }

  const catchHead = /\bcatch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*\{/g;
  for (const match of code.matchAll(catchHead)) {
    const parameterStart = (match.index ?? 0) + match[0].indexOf(match[1]);
    const body = (match.index ?? 0) + match[0].lastIndexOf("{") + 1;
    addParameters(parameterStart, parameterStart + match[1].length, body);
  }

  const assignment = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  for (const match of code.matchAll(assignment)) {
    const target = match.index ?? 0;
    const operator = target + match[0].lastIndexOf("=");
    let previous = target - 1;
    while (previous >= 0 && /\s/.test(code[previous])) previous -= 1;
    if (code[previous] === "." || declarationOperators.has(operator) || /[=!<>]/.test(code[operator - 1] ?? "") || /[=>]/.test(code[operator + 1] ?? "")) continue;
    const nearest = visibleBindings(bindings, match[1], target, scopes);
    if (nearest.length !== 1) continue;
    let start = operator + 1;
    while (/\s/.test(content[start] ?? "")) start += 1;
    const end = initializerEnd(code, start);
    if (content.slice(start, end).trim() === "") continue;
    nearest[0].values.push({ start, end, assignedAt: operator, kind: "assignment" });
  }
  return bindings;
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
  const bindings = localBindings(content, code, scopes);
  const ranges: SourceRange[] = [...seeds];
  const failures: ScanFailure[] = [];
  const states = new Map<number, "visiting" | "done">();
  const resolve = (name: string, origin: SourceRange) => {
    const candidates = visibleBindings(bindings, name, origin.start, scopes);
    if (candidates.length === 0) return;
    if (candidates.length !== 1) {
      failures.push({ ...origin, reason: `ambiguous class value ${name}` });
      return;
    }
    const binding = candidates[0];
    const assignment = binding.values
      .filter((value) => value.kind === "assignment" && value.assignedAt < origin.start)
      .sort((left, right) => right.assignedAt - left.assignedAt)[0];
    const value = assignment ?? binding.values.find((candidate) => candidate.kind === "declaration");
    if (!value) return;
    if (states.get(value.start) === "visiting") {
      failures.push({ ...origin, reason: `cyclic class value ${name}` });
      return;
    }
    if (states.get(value.start) === "done") return;
    states.set(value.start, "visiting");
    ranges.push(value);
    for (const reference of referencedIdentifiers(content, code, { ...value, kind: "expression" })) resolve(reference, value);
    states.set(value.start, "done");
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
