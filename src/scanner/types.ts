import type { ProjectFingerprint, ProjectType, Signal } from "../types.ts";

export type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

export type ProjectSignalContribution = {
  projectTypes?: ProjectType[];
  frameworks?: Signal[];
  styling?: Signal[];
  testing?: ProjectFingerprint["testing"];
  infrastructure?: Signal[];
  tags?: string[];
  warnings?: string[];
};

export type ProjectSignalContext = {
  root: string;
  packageJson?: PackageJson;
  files: string[];
  hasAnyFile(names: string[]): Promise<string[]>;
  dependencyVersion(name: string): string | undefined;
  dependencyEvidence(name: string): string[];
  dependencyMajorVersion(name: string): number | undefined;
  signal(name: string, confidence: number, evidence: string[]): Signal;
};

export type ProjectSignalProvider = {
  id: string;
  detect(context: ProjectSignalContext): Promise<ProjectSignalContribution>;
};
