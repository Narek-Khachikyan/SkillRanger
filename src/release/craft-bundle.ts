import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { packageRoot } from "../paths.ts";
import { loadCraftCatalog } from "../domains/frontend/design/craft.ts";

export const defaultCraftRoot = path.join(packageRoot, "domains", "frontend", "craft");
export const defaultSkillPackageRoot = path.join(
  packageRoot,
  "registry",
  "skills",
  "frontend.visual-design-polish",
);

export const bundledCraftDirectory = (skillPackageRoot: string) =>
  path.join(skillPackageRoot, "references", "craft");

export type CraftBundleSource = {
  name: string;
  sourcePath: string;
};

// The single source of truth for what the craft bundle contains: the catalog plus
// the four reference files it names. Both the bundler and the release-certification
// drift gate derive from this map, so the two never disagree about the file set.
export const craftBundleSources = async (craftRoot: string): Promise<CraftBundleSource[]> => {
  const { references } = await loadCraftCatalog(craftRoot);
  return [
    { name: "craft-catalog.json", sourcePath: path.join(craftRoot, "craft-catalog.json") },
    ...references.map(({ file }) => ({ name: file, sourcePath: path.join(craftRoot, file) })),
  ];
};

export const bundleFrontendCraft = async (input: {
  craftRoot?: string;
  skillPackageRoot?: string;
} = {}): Promise<{ files: string[]; catalogIdentity: { id: string; kinds: string[] } }> => {
  const craftRoot = path.resolve(input.craftRoot ?? defaultCraftRoot);
  const skillPackageRoot = path.resolve(input.skillPackageRoot ?? defaultSkillPackageRoot);
  // The target subpath is constructed, never caller-supplied, so writes stay inside
  // the skill package's references/craft directory regardless of the package root.
  const targetRoot = bundledCraftDirectory(skillPackageRoot);

  // Validate the canonical source first: nothing is bundled from an invalid corpus.
  const { catalog } = await loadCraftCatalog(craftRoot);
  const sources = await craftBundleSources(craftRoot);
  const sourceNames = new Set(sources.map(({ name }) => name));

  // Remove stale bundled files so the skill package never carries a craft file the
  // domain pack no longer publishes.
  const existingTargetEntries = await readdir(targetRoot).catch(() => [] as string[]);
  for (const entry of existingTargetEntries) {
    if (!sourceNames.has(entry)) {
      await rm(path.join(targetRoot, entry), { force: true });
    }
  }

  await mkdir(targetRoot, { recursive: true });
  const files: string[] = [];
  for (const { name, sourcePath } of sources) {
    const source = await readFile(sourcePath);
    await writeFile(path.join(targetRoot, name), source);
    files.push(`references/craft/${name}`);
  }

  const catalogIdentity = { id: catalog.id, kinds: Object.keys(catalog.categories) };
  return { files: [...files].sort(), catalogIdentity };
};
