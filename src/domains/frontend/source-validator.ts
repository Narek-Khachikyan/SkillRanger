import type { Result } from "../../runtime/strict/core-validators.ts";
import type { DomainValidatorProjection } from "../types.ts";
import { validateFrontendSources } from "./design/source-validation.ts";

export const sourceGateSlugs = [
  "no-dynamic-tailwind-classes",
  "raw-colors-reviewed",
  "repeated-class-bundles-reviewed",
];

const gateSlug = (gateId: string) => gateId.slice(gateId.lastIndexOf("/") + 1);

const quotedPathEnd = (value: string, start: number) => {
  if (value[start] !== "\"") return undefined;
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === "\\") index += 1;
    else if (value[index] === "\"") return index + 1;
  }
  return undefined;
};
const validFileHeader = (line: string, prefix: "--- " | "+++ ") => {
  if (!line.startsWith(prefix)) return false;
  const value = line.slice(prefix.length);
  if (value.startsWith("\"")) {
    const end = quotedPathEnd(value, 0);
    if (end === undefined || end === 2) return false;
    return end === value.length || value[end] === "\t";
  }
  const tab = value.indexOf("\t");
  const filePath = tab === -1 ? value : value.slice(0, tab);
  return filePath !== "" && !/[\r\n]/.test(filePath);
};
const oldFileHeader = (line: string) => validFileHeader(line, "--- ");
const newFileHeader = (line: string) => validFileHeader(line, "+++ ");
const diffPathEnd = (value: string, start: number) => {
  if (value[start] === "\"") return quotedPathEnd(value, start);
  let index = start;
  while (index < value.length && !/\s/.test(value[index])) index += 1;
  return index === start ? undefined : index;
};
const diffHeader = (line: string) => {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) return false;
  let cursor = prefix.length;
  const oldEnd = diffPathEnd(line, cursor);
  if (oldEnd === undefined || line[oldEnd] !== " ") return false;
  cursor = oldEnd;
  while (line[cursor] === " ") cursor += 1;
  const newEnd = diffPathEnd(line, cursor);
  return newEnd !== undefined && newEnd === line.length;
};
const hunkHeader = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?: .*)?$/;
const noNewlineMarker = "\\ No newline at end of file";
const parseUnifiedDiffAddedContent = (content: string) => {
  const lines = content.split(/\r?\n/);
  const added: string[] = [];
  let index = 0;
  let files = 0;
  while (index < lines.length) {
    if (lines.slice(index).every((line) => line === "")) break;
    if (diffHeader(lines[index])) {
      index += 1;
      while (index < lines.length && !oldFileHeader(lines[index])) {
        if (diffHeader(lines[index]) || hunkHeader.test(lines[index])) return undefined;
        index += 1;
      }
    }
    if (!oldFileHeader(lines[index] ?? "") || !newFileHeader(lines[index + 1] ?? "")) return undefined;
    files += 1;
    index += 2;
    let hunks = 0;
    while (index < lines.length) {
      const header = hunkHeader.exec(lines[index]);
      if (!header) break;
      hunks += 1;
      let oldRemaining = header[1] === undefined ? 1 : Number(header[1]);
      let newRemaining = header[2] === undefined ? 1 : Number(header[2]);
      index += 1;
      while (oldRemaining > 0 || newRemaining > 0) {
        const line = lines[index];
        if (line === undefined) return undefined;
        const prefix = line[0];
        let markerApplies = false;
        if (prefix === " ") { oldRemaining -= 1; newRemaining -= 1; }
        else if (prefix === "-") oldRemaining -= 1;
        else if (prefix === "+") { newRemaining -= 1; added.push(line.slice(1)); }
        else return undefined;
        if (oldRemaining < 0 || newRemaining < 0) return undefined;
        if (prefix === "-") markerApplies = oldRemaining === 0;
        else if (prefix === "+") markerApplies = newRemaining === 0;
        else markerApplies = oldRemaining === 0 && newRemaining === 0;
        index += 1;
        if (lines[index] === noNewlineMarker) {
          if (!markerApplies) return undefined;
          index += 1;
          if (lines[index] === noNewlineMarker) return undefined;
        }
      }
    }
    if (hunks === 0) return undefined;
    if (index < lines.length && lines[index] !== "" && !diffHeader(lines[index]) && !oldFileHeader(lines[index])) return undefined;
  }
  return files > 0 ? added.join("\n") : undefined;
};

const addedUnifiedDiffContent = (content: string) => parseUnifiedDiffAddedContent(content) ?? content;

export const deriveTailwindSourceResults = (content: string): Record<string, Result> => {
  const findings = validateFrontendSources(
    [{ path: "implementation.diff", content: addedUnifiedDiffContent(content) }],
    { semanticTokensPresent: true },
  );
  return {
    "no-dynamic-tailwind-classes": { passed: !findings.some(({ code, gate }) => code === "tailwind-dynamic-class" && gate === "hard") },
    "raw-colors-reviewed": { passed: !findings.some(({ code }) => code === "design-system-raw-color") },
    "repeated-class-bundles-reviewed": { passed: !findings.some(({ code }) => code === "tailwind-conflicting-utilities") },
  };
};

export const evaluateTailwindSource = (projection: DomainValidatorProjection): Result => {
  const slug = gateSlug(projection.gateId);
  if (!sourceGateSlugs.includes(slug)) return { passed: false, message: `Tailwind source check failed ${slug}.` };
  const reviews = Array.isArray(projection.sourceReview)
    ? projection.sourceReview.filter((content): content is string => typeof content === "string")
    : [];
  const failed = reviews
    .map((content) => deriveTailwindSourceResults(content))
    .find((candidate) => candidate[slug]?.passed !== true)?.[slug];
  return failed ?? (reviews.length > 0
    ? { passed: true }
    : { passed: false, message: "No implementation diff evidence was staged." });
};
