import { loadLocalRegistry } from "../registry/index.ts";

export const maxSkillInputEntries = 32;

const canonicalId = /^[a-z0-9][a-z0-9._-]{1,127}$/;

export class SkillInputsError extends Error {
  readonly code = "invalid-arguments";
}

const fail = (message: string): never => { throw new SkillInputsError(message); };

/** Validate an already-parsed skill inputs object. Callers own deserialization. */
export const validateSkillInputs = async (
  value: unknown,
  registryRoot: string,
): Promise<Record<string, Record<string, unknown>>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("skill inputs must be a JSON object.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maxSkillInputEntries) fail("skill inputs contain too many skill IDs.");
  const registryIds = new Set((await loadLocalRegistry(registryRoot)).map(({ manifest }) => manifest.id));
  for (const [skillId, skillInput] of entries) {
    if (!canonicalId.test(skillId) || !registryIds.has(skillId)) fail(`skill inputs contain an unknown bundled skill ID: ${skillId}.`);
    if (typeof skillInput !== "object" || skillInput === null || Array.isArray(skillInput)) fail(`skill input for ${skillId} must be a JSON object.`);
  }
  return value as Record<string, Record<string, unknown>>;
};
