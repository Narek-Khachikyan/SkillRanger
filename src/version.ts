import { readFile } from "node:fs/promises";
import path from "node:path";
import { packageRoot } from "./paths.ts";

export const readSkillRangerVersion = async (): Promise<string> => {
  const packageJsonPath = path.join(packageRoot, "package.json");

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    if (typeof packageJson.version === "string" && packageJson.version.trim() !== "") {
      return packageJson.version;
    }
  } catch {
    // Report one stable package-identity error for missing, unreadable, or malformed data.
  }

  throw new Error(`Invalid package version at ${packageJsonPath}`);
};
