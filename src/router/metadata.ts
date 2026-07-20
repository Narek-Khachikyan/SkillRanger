import path from "node:path";

export const routerMetadataLimits = {
  maxArrayItems: 64,
  maxTokenBytes: 128,
  maxEnvironmentSignalBytes: 256,
  maxManifestBytes: 256_000,
  maxObjectDepth: 16,
  maxDomainPacks: 64,
} as const;

export type MetadataValidationIssue = {
  path: string;
  message: string;
};

const canonicalTokenPattern = /^[a-z0-9][a-z0-9._-]*$/;
const environmentOperators = new Set([
  "tag",
  "framework",
  "language",
  "testing",
  "infrastructure",
  "dependency",
  "file",
]);

export const normalizeMetadataToken = (value: string) =>
  value.normalize("NFKC").toLowerCase();

export const validateMetadataArray = (
  value: unknown,
  at: string,
  options: {
    allowed?: ReadonlySet<string>;
    canonicalTokens?: boolean;
  } = {},
): MetadataValidationIssue[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return [{ path: at, message: "Must be an array of strings." }];
  }
  const issues: MetadataValidationIssue[] = [];
  if (value.length > routerMetadataLimits.maxArrayItems) {
    issues.push({ path: at, message: `Must contain at most ${routerMetadataLimits.maxArrayItems} items.` });
  }
  const normalized = new Set<string>();
  value.forEach((entry, index) => {
    const token = normalizeMetadataToken(entry);
    if (Buffer.byteLength(entry, "utf8") > routerMetadataLimits.maxTokenBytes) {
      issues.push({ path: `${at}.${index}`, message: `Token must be at most ${routerMetadataLimits.maxTokenBytes} UTF-8 bytes.` });
    }
    if (!entry || (options.canonicalTokens !== false && !canonicalTokenPattern.test(entry))) {
      issues.push({ path: `${at}.${index}`, message: "Must be a canonical metadata token." });
    }
    if (options.allowed && !options.allowed.has(entry)) {
      issues.push({ path: `${at}.${index}`, message: "Contains an unsupported value." });
    }
    if (normalized.has(token)) {
      issues.push({ path: at, message: "Values must be unique after NFKC lowercase normalization." });
    }
    normalized.add(token);
  });
  return issues;
};

export const validateEnvironmentSignal = (
  value: string,
  at: string,
): MetadataValidationIssue[] => {
  const issues: MetadataValidationIssue[] = [];
  if (Buffer.byteLength(value, "utf8") > routerMetadataLimits.maxEnvironmentSignalBytes) {
    issues.push({ path: at, message: `Expression must be at most ${routerMetadataLimits.maxEnvironmentSignalBytes} UTF-8 bytes.` });
  }
  const separator = value.indexOf(":");
  const operator = separator > 0 ? value.slice(0, separator) : "";
  const operand = separator > 0 ? value.slice(separator + 1) : "";
  if (!environmentOperators.has(operator)) {
    issues.push({ path: at, message: "Contains an unsupported environment signal operator." });
    return issues;
  }
  if (
    !operand ||
    path.posix.isAbsolute(operand) ||
    path.win32.isAbsolute(operand) ||
    operand.replace(/\\/g, "/").split("/").includes("..") ||
    /[{}]/.test(operand) ||
    operand.includes("$(") ||
    operand.includes("`")
  ) {
    issues.push({ path: at, message: "Contains an unsafe environment signal operand." });
    return issues;
  }
  const validOperand = operator === "file"
    ? /^[a-zA-Z0-9_@*?./-]+$/.test(operand)
    : /^[a-z0-9@][a-z0-9@._/+:-]*$/.test(operand);
  if (!validOperand) {
    issues.push({ path: at, message: "Contains an invalid environment signal operand." });
  }
  return issues;
};

export const objectDepth = (value: unknown): number => {
  if (value === null || typeof value !== "object") return 0;
  const pending: Array<{ value: object; depth: number }> = [{ value, depth: 1 }];
  const visited = new WeakSet<object>();
  let maximum = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    maximum = Math.max(maximum, current.depth);
    if (maximum > routerMetadataLimits.maxObjectDepth) return maximum;
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (const child of children) {
      if (child !== null && typeof child === "object") pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return maximum;
};
