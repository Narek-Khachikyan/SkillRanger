import path from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const defaultRegistryRoot = path.join(packageRoot, "registry");

export const defaultFrontendEvalSuitePath = path.join(
  packageRoot,
  "evals",
  "frontend",
  "suite.json",
);
