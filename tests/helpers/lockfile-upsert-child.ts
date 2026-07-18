import { access, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { auditSkill } from "../../src/audit/index.ts";
import { upsertInstalledSkill } from "../../src/lockfile/index.ts";
import { findSkill } from "../../src/registry/index.ts";

const [projectRoot, skillId, acquiredMarker, releaseMarker] = process.argv.slice(2);
if (!projectRoot || !skillId || !acquiredMarker) {
  throw new Error("Expected project root, skill id, and acquired marker arguments.");
}

const skill = await findSkill(skillId, "registry");
if (!skill) throw new Error(`Unknown test skill: ${skillId}`);
const audit = await auditSkill(skill);

await upsertInstalledSkill(
  projectRoot,
  skill,
  {
    targetAgent: "codex",
    scope: "repo",
    installedPath: `.agents/skills/${skill.manifest.id}`,
    audit,
  },
  {
    afterTransactionLockAcquired: async () => {
      await writeFile(acquiredMarker, "acquired\n");
      if (!releaseMarker) return;
      while (true) {
        try {
          await access(releaseMarker);
          return;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        await delay(20);
      }
    },
  },
);
