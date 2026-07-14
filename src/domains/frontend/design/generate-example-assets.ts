import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderExamplePlate } from "./example-renderer.ts";
import { defaultExamplesRoot, loadRecipeExamplePacks } from "./examples.ts";

export const generateExampleAssets = async (root = defaultExamplesRoot) => {
  const examplesRoot = path.resolve(root);
  const packs = await loadRecipeExamplePacks(examplesRoot);
  const outputs: string[] = [];
  for (const pack of packs) {
    const packRoot = path.dirname(pack.sourcePath);
    for (const scene of pack.scenes) {
      const outputPath = path.resolve(scene.assetPath);
      if (!outputPath.startsWith(`${packRoot}${path.sep}`)) {
        throw new Error(`Generated example asset escapes pack: ${scene.asset}`);
      }
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, renderExamplePlate(scene), "utf8");
      outputs.push(outputPath);
    }
  }
  return outputs;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await generateExampleAssets();
}
